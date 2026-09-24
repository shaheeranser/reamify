import {
	detectVectorGridInRegion,
	extractTablesWithStructureCells,
	extractTablesInRegions,
	type TextItem,
	type StructuredCellJs,
	type PageRegions,
} from '@firecrawl/pdf-inspector';

import { discoverRegions } from './region.js';
import { buildPageLayout, buildRegion } from './headers.js';
import { identifyTitles, assignOutsideText } from './text.js';
import { markdownToRows } from '../legacy/parser.js';
import { clusterRows } from './rows.js';
import { inferColumnRanges } from './columns.js';

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

function tryRegionTable(
	buffer: Buffer,
	regionBBox: BBox,
	pageIdx: number,
): string[][] | null {
	const pageRegions: PageRegions[] = [
		{
			page: pageIdx,
			regions: [regionBBox as unknown as number[]],
		},
	];

	const results = extractTablesInRegions(buffer, pageRegions);
	if (results.length === 0) return null;

	const regionTexts = results[0]!;
	if (regionTexts.regions.length === 0) return null;

	const regionText = regionTexts.regions[0]!;
	if (regionText.needsOcr || !regionText.text || regionText.text.trim().length === 0) {
		return null;
	}

	const rows = markdownToRows(regionText.text);
	return rows.length > 0 ? rows : null;
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

	const regions: TableRegion[] = [];

	for (let regionIdx = 0; regionIdx < clusters.length; regionIdx++) {
		const cluster = clusters[regionIdx]!;
		const regionBBox: BBox = [cluster.xMin, cluster.yMin, cluster.xMax, cluster.yMax];

		let region: TableRegion | null = null;

		if (mode === 'auto') {
			try {
				const structuredCells = tryStructuredCells(buffer, regionBBox, pageNum);
				if (structuredCells && structuredCells.length > 0) {
					const rows = structuredCellsToRows(structuredCells);
					region = {
						id: regionIdx,
						page: pageNum,
						bbox: regionBBox,
						source: 'vector-grid-cells',
						rows,
					};
				}
			} catch {
				onWarning?.({
					kind: 'tier-fallback',
					page: pageNum,
					message: `Tier A (vector grid) failed for region ${regionIdx}, trying Tier B`,
					regionId: regionIdx,
				});
			}
		}

		if (!region && mode === 'auto') {
			try {
				const mdRows = tryRegionTable(buffer, regionBBox, pageNum);
				if (mdRows && mdRows.length > 0) {
					const bRows = clusterRows(cluster.items, pageHeight);
					const expectedCols = inferColumnRanges(bRows)?.length ?? 0;
					if (expectedCols === 0 || mdRows[0]!.length >= expectedCols) {
						const rows = markdownRowsToTableRows(mdRows, regionBBox);
						region = {
							id: regionIdx,
							page: pageNum,
							bbox: regionBBox,
							source: 'region-tables',
							rows,
						};
					}
				}
			} catch {
				onWarning?.({
					kind: 'tier-fallback',
					page: pageNum,
					message: `Tier B (region tables) failed for region ${regionIdx}, falling back to Tier C`,
					regionId: regionIdx,
				});
			}
		}

		if (!region) {
			// Tier C: the cluster was already established as a region by
			// `discoverRegions`. Build exactly one region from it — re-running
			// region discovery here re-partitioned the cluster and could split
			// a table's own columns off, which previously led to the last
			// column being dropped without any warning.
			const fallbackRegion = buildRegion(
				cluster.items,
				regionIdx,
				pageNum,
				pageHeight,
				regionBBox,
			);
			if (fallbackRegion) {
				regions.push(fallbackRegion);
			} else {
				onWarning?.({
					kind: 'tier-fallback',
					page: pageNum,
					message: `Tier C produced no region for cluster ${regionIdx}; its content was not emitted`,
					regionId: regionIdx,
				});
			}
			continue;
		}

		regions.push(region);
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
