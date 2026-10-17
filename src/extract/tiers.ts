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
	mode: ExtractionMode = 'auto',
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
		region: TableRegion | null;
	}> = clusters.map((cluster) => {
		const regionBBox: BBox = [cluster.xMin, cluster.yMin, cluster.xMax, cluster.yMax];

		// How wide this table is expected to be, from its own header structure
		// and from the document-wide model. Never from the markdown being
		// validated: a region that was split off its table would otherwise
		// under-report its own column count and pass its own check.
		const baselineRows = clusterRows(cluster.items, pageHeight);
		const regionCols = inferColumnRanges(baselineRows)?.length ?? 0;
		columnModel?.observe(regionCols);
		const expectedCols = Math.max(regionCols, columnModel?.expected() ?? 0);

		return { cluster, bbox: regionBBox, expectedCols, region: null };
	});

	if (mode === 'auto') {
		// Tier A: vector-ruled grids. The inspector exposes no batch form for
		// grid detection, so this stays one call per region.
		for (let i = 0; i < builds.length; i++) {
			const build = builds[i]!;
			try {
				const structuredCells = tryStructuredCells(buffer, build.bbox, pageNum);
				if (structuredCells && structuredCells.length > 0) {
					build.region = {
						id: i,
						page: pageNum,
						bbox: build.bbox,
						source: 'vector-grid-cells',
						rows: structuredCellsToRows(structuredCells),
					};
				}
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
			.filter((entry) => !entry.build.region);

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
					if (mdRows && mdRows.length > 0) {
						if (build.expectedCols === 0 || mdRows[0]!.length >= build.expectedCols) {
							build.region = {
								id: entry.i,
								page: pageNum,
								bbox: build.bbox,
								source: 'region-tables',
								rows: markdownRowsToTableRows(mdRows, build.bbox),
							};
						}
					}
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
		if (build.region) {
			regions.push(build.region);
			continue;
		}

		// Tier C: the cluster was already established as a region by
		// `discoverRegions`. Build exactly one region from it — re-running
		// region discovery here re-partitioned the cluster and could split
		// a table's own columns off, which previously led to the last
		// column being dropped without any warning.
		const fallbackRegion = buildRegion(
			build.cluster.items,
			i,
			pageNum,
			pageHeight,
			build.bbox,
		);
		if (fallbackRegion) {
			regions.push(fallbackRegion);
		} else {
			onWarning?.({
				kind: 'tier-fallback',
				page: pageNum,
				message: `Tier C produced no region for cluster ${i}; its content was not emitted`,
				regionId: i,
			});
		}
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
