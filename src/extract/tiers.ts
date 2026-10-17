import {
	detectVectorGridInRegion,
	extractTablesWithStructureCells,
	extractTablesInRegions,
	type TextItem,
	type StructuredCellJs,
	type PageRegions,
} from '@firecrawl/pdf-inspector';

import { discoverRegions, type ItemCluster } from './region.js';
import { buildPageLayout, buildRegion } from './headers.js';
import { identifyTitles, assignOutsideText } from './text.js';
import { markdownToRows } from '../legacy/parser.js';
import { clusterRows } from './rows.js';
import { inferColumnRanges } from './columns.js';
import type { ColumnCountModel } from './column-model.js';

import type {
	BBox,
	TableCell,
	TableRow,
	TableRegion,
	PageLayout,
	OnWarning,
	ExtractionMode,
} from '../types.js';

const VECTOR_GRID_DPI = 150;

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

function countWords(rows: TableRow[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		for (const cell of row.cells) {
			for (const token of cell.text.toLowerCase().split(WORD_SPLIT)) {
				if (token.length > 0) counts.set(token, (counts.get(token) ?? 0) + 1);
			}
		}
	}
	return counts;
}

interface ContentCoverage {
	recall: number;
	missing: number;
}

/**
 * How much of the clustered baseline's word content a native tier result
 * retains.
 *
 * The native region-table extractor can silently drop trailing or irregular
 * rows (observed losses from one row to 83% of a page's rows across real
 * documents). The clustered path uses the same page items and is essentially
 * always complete, so a native result that is missing *any* of the cluster's
 * own words is treated as incomplete and rejected rather than allowed to
 * discard content.
 */
function contentCoverage(baselineRows: TableRow[], candidateRows: TableRow[]): ContentCoverage {
	const baseline = countWords(baselineRows);
	if (baseline.size === 0) return { recall: 1, missing: 0 };

	const candidate = countWords(candidateRows);
	let total = 0;
	let matched = 0;
	for (const [token, count] of baseline) {
		total += count;
		matched += Math.min(count, candidate.get(token) ?? 0);
	}
	return { recall: total === 0 ? 1 : matched / total, missing: total - matched };
}

function tryStructuredCells(
	buffer: Buffer,
	regionBBox: BBox,
	pageIdx: number,
): StructuredCellJs[] | null {
	const grid = detectVectorGridInRegion(
		buffer,
		pageIdx,
		regionBBox as unknown as number[],
		VECTOR_GRID_DPI,
	);

	if (!grid) return null;

	const results = extractTablesWithStructureCells(buffer, [
		{
			page: pageIdx,
			cropPdfPtBbox: regionBBox as unknown as number[],
			renderDpi: VECTOR_GRID_DPI,
			structureTokens: grid.structureTokens,
			cellBboxes: grid.cellBboxes,
		},
	]);

	if (results.length === 0 || results[0]!.length === 0) return null;
	return results[0]!;
}

function structuredCellsToRows(cells: StructuredCellJs[]): TableRow[] {
	if (cells.length === 0) return [];

	const rowMap = new Map<number, StructuredCellJs[]>();
	for (const cell of cells) {
		let row = rowMap.get(cell.row);
		if (!row) {
			row = [];
			rowMap.set(cell.row, row);
		}
		row.push(cell);
	}

	const rows: TableRow[] = [];
	const sortedRowIndices = [...rowMap.keys()].sort((a, b) => a - b);

	for (const rowIdx of sortedRowIndices) {
		const rowCells = rowMap.get(rowIdx)!;
		rowCells.sort((a, b) => a.col - b.col);

		const tableCells: TableCell[] = rowCells.map((sc) => ({
			text: sc.text.trim(),
			bbox: sc.pagePtBbox as unknown as BBox,
			column: sc.col,
			rowspan: sc.rowspan,
			colspan: sc.colspan,
			isHeader: sc.isHeader,
			confidence: 1.0,
			ambiguous: false,
		}));

		const isHeader = rowCells.some((sc) => sc.isHeader);

		rows.push({
			index: rowIdx,
			isHeader,
			cells: tableCells,
		});
	}

	return rows;
}

/**
 * Extract markdown tables for every region on one page in a single native
 * call. The inspector re-parses the whole document per call, so batching all
 * of a page's regions into one `PageRegions` avoids paying that parse once
 * per region. Returns one result per input bbox, in the same order; `null`
 * where the region produced no usable table.
 */
function tryRegionTables(
	buffer: Buffer,
	regionBBoxes: BBox[],
	pageIdx: number,
): Array<string[][] | null> {
	if (regionBBoxes.length === 0) return [];

	const pageRegions: PageRegions[] = [
		{
			page: pageIdx,
			regions: regionBBoxes as unknown as number[][],
		},
	];

	const results = extractTablesInRegions(buffer, pageRegions);
	const regionTexts = results[0]?.regions ?? [];

	return regionBBoxes.map((_, regionIdx) => {
		const regionText = regionTexts[regionIdx];
		if (!regionText || regionText.needsOcr || !regionText.text || regionText.text.trim().length === 0) {
			return null;
		}

		const rows = markdownToRows(regionText.text);
		return rows.length > 0 ? rows : null;
	});
}

function markdownRowsToTableRows(
	rows: string[][],
	regionBBox: BBox,
): TableRow[] {
	if (rows.length === 0) return [];

	const regionWidth = regionBBox[2] - regionBBox[0];
	const regionHeight = regionBBox[3] - regionBBox[1];

	return rows.map((cells, rowIdx) => {
		const colWidth = cells.length > 0 ? regionWidth / cells.length : regionWidth;
		const rowHeight = rows.length > 0 ? regionHeight / rows.length : regionHeight;

		const tableCells: TableCell[] = cells.map((text, colIdx) => ({
			text: text.trim(),
			bbox: [
				regionBBox[0] + colIdx * colWidth,
				regionBBox[1] + rowIdx * rowHeight,
				regionBBox[0] + (colIdx + 1) * colWidth,
				regionBBox[1] + (rowIdx + 1) * rowHeight,
			] as BBox,
			column: colIdx,
			rowspan: 1,
			colspan: 1,
			isHeader: rowIdx === 0,
			confidence: 0.85,
			ambiguous: false,
		}));

		return {
			index: rowIdx,
			isHeader: rowIdx === 0,
			cells: tableCells,
		};
	});
}

export function extractPageLayout(
	buffer: Buffer,
	items: TextItem[],
	pageNum: number,
	pageWidth: number,
	pageHeight: number,
	mode: ExtractionMode = 'clustered',
	onWarning?: OnWarning,
	columnModel?: ColumnCountModel,
): PageLayout {
	if (mode === 'positions') {
		return buildPageLayout(items, pageNum, pageWidth, pageHeight);
	}

	const textItems = items.filter(
		(it) => it.itemType === 'Text' && it.text.trim().length > 0,
	);

	if (textItems.length === 0) {
		return {
			page: pageNum,
			regions: [],
			titles: [],
			outsideText: [],
			needsOcr: false,
		};
	}

	const clusters = discoverRegions(textItems, pageWidth, pageHeight);

	if (clusters.length === 0) {
		return buildPageLayout(items, pageNum, pageWidth, pageHeight);
	}

	const builds: Array<{
		cluster: ItemCluster;
		bbox: BBox;
		expectedCols: number;
		baseline: TableRegion | null;
		region: TableRegion | null;
		native: boolean;
	}> = clusters.map((cluster, index) => {
		const regionBBox: BBox = [cluster.xMin, cluster.yMin, cluster.xMax, cluster.yMax];

		// How wide this table is expected to be, from its own header structure
		// and from the document-wide model. Never from the markdown being
		// validated: a region that was split off its table would otherwise
		// under-report its own column count and pass its own check.
		const baselineRows = clusterRows(cluster.items, pageHeight);
		const regionCols = inferColumnRanges(baselineRows)?.length ?? 0;
		columnModel?.observe(regionCols);
		const expectedCols = Math.max(regionCols, columnModel?.expected() ?? 0);

		// Build the clustered baseline up front. It is the completeness
		// reference every native tier result must survive, and the region used
		// whenever a native tier cannot produce a more complete table.
		const baseline = buildRegion(cluster.items, index, pageNum, pageHeight, regionBBox);

		return { cluster, bbox: regionBBox, expectedCols, baseline, region: baseline, native: false };
	});

	if (mode === 'auto') {
		// Tier A: vector-ruled grids. The inspector exposes no batch form for
		// grid detection, so this stays one call per region.
		for (let i = 0; i < builds.length; i++) {
			const build = builds[i]!;
			try {
				const structuredCells = tryStructuredCells(buffer, build.bbox, pageNum);
				if (!structuredCells || structuredCells.length === 0) continue;

				const rows = structuredCellsToRows(structuredCells);
				const coverage = build.baseline
					? contentCoverage(build.baseline.rows, rows)
					: { recall: 1, missing: 0 };
				if (coverage.missing > 0) {
					onWarning?.({
						kind: 'tier-incomplete',
						page: pageNum,
						regionId: i,
						message: `Tier A (vector grid) dropped ${coverage.missing} word(s) (${((1 - coverage.recall) * 100).toFixed(1)}%) from region ${i}; using clustered extraction instead`,
					});
					continue;
				}

				build.region = {
					id: i,
					page: pageNum,
					bbox: build.bbox,
					source: 'vector-grid-cells',
					rows,
				};
				build.native = true;
			} catch {
				onWarning?.({
					kind: 'tier-fallback',
					page: pageNum,
					message: `Tier A (vector grid) failed for region ${i}, trying Tier B`,
					regionId: i,
				});
			}
		}

		// Tier B: region table detection, one native call for every region on
		// the page instead of one call per region.
		const pending = builds
			.map((build, i) => ({ build, i }))
			.filter((entry) => !entry.build.native);

		if (pending.length > 0) {
			try {
				const mdRowSets = tryRegionTables(
					buffer,
					pending.map((entry) => entry.build.bbox),
					pageNum,
				);
				pending.forEach((entry, k) => {
					const build = entry.build;
					const mdRows = mdRowSets[k];
					if (!mdRows || mdRows.length === 0) return;
					if (build.expectedCols > 0 && mdRows[0]!.length < build.expectedCols) return;

					const rows = markdownRowsToTableRows(mdRows, build.bbox);
					const coverage = build.baseline
						? contentCoverage(build.baseline.rows, rows)
						: { recall: 1, missing: 0 };
					if (coverage.missing > 0) {
						onWarning?.({
							kind: 'tier-incomplete',
							page: pageNum,
							regionId: entry.i,
							message: `Tier B (region tables) dropped ${coverage.missing} word(s) (${((1 - coverage.recall) * 100).toFixed(1)}%) from region ${entry.i}; using clustered extraction instead`,
						});
						return;
					}

					build.region = {
						id: entry.i,
						page: pageNum,
						bbox: build.bbox,
						source: 'region-tables',
						rows,
					};
					build.native = true;
				});
			} catch {
				for (const entry of pending) {
					onWarning?.({
						kind: 'tier-fallback',
						page: pageNum,
						message: `Tier B (region tables) failed for region ${entry.i}, falling back to Tier C`,
						regionId: entry.i,
					});
				}
			}
		}
	}

	const regions: TableRegion[] = [];

	for (let i = 0; i < builds.length; i++) {
		const build = builds[i]!;

		// `build.region` is the Tier C (clustered) baseline — built from the
		// cluster that `discoverRegions` already established, without
		// re-partitioning — unless a native tier produced a more complete
		// table. Re-running region discovery here previously split a table's
		// own columns off and dropped the last column without a warning.
		if (build.region) {
			regions.push(build.region);
			continue;
		}

		onWarning?.({
			kind: 'tier-fallback',
			page: pageNum,
			message: `Tier C produced no region for cluster ${i}; its content was not emitted`,
			regionId: i,
		});
	}

	// Reassign stable ids.
	for (let i = 0; i < regions.length; i++) {
		regions[i]!.id = i;
	}

	const topRegionY = Math.min(...clusters.map((c) => c.yMin));
	const titles = identifyTitles(textItems, topRegionY, pageHeight);
	const outsideText = assignOutsideText(textItems, clusters, pageHeight);

	for (const ot of outsideText) {
		if (!ot.assigned) {
			onWarning?.({
				kind: 'unassigned-text',
				page: pageNum,
				message: `Unassigned text: "${ot.text.substring(0, 50)}${ot.text.length > 50 ? '...' : ''}"`,
			});
		}
	}

	return {
		page: pageNum,
		regions,
		titles,
		outsideText,
		needsOcr: false,
	};
}
