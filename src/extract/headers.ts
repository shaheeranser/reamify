import type { TextItem } from '@firecrawl/pdf-inspector';
import type { PageLayout, TableRegion, TableRow, TableCell, BBox } from '../types.js';
import { discoverRegions } from './region.js';
import { clusterRows } from './rows.js';
import {
	inferColumnRanges,
	assignColumnByRange,
	inferColumnBoundaries,
	assignColumn,
} from './columns.js';
import { identifyTitles, assignOutsideText } from './text.js';
import { itemBBox, mergeBBoxes } from './geometry.js';

function buildTableRows(items: TextItem[], pageHeight: number): TableRow[] {
	const baselineRows = clusterRows(items, pageHeight);

	// Try header-anchored column ranges first; fall back to legacy clustering.
	const columnRanges = inferColumnRanges(baselineRows);
	const legacyBoundaries = columnRanges ? null : inferColumnBoundaries(baselineRows);

	const tableRows: TableRow[] = [];

	for (let rowIdx = 0; rowIdx < baselineRows.length; rowIdx++) {
		const bRow = baselineRows[rowIdx]!;
		const cellMap = new Map<number, { texts: string[]; bboxes: BBox[] }>();

		for (const item of bRow.items) {
			const col = columnRanges
				? assignColumnByRange(item.x, item.width, columnRanges)
				: assignColumn(item.x, legacyBoundaries!);
			let entry = cellMap.get(col);
			if (!entry) {
				entry = { texts: [], bboxes: [] };
				cellMap.set(col, entry);
			}
			entry.texts.push(item.text);
			entry.bboxes.push(itemBBox(item, pageHeight));
		}

		const cells: TableCell[] = [];
		for (const [col, entry] of cellMap) {
			const mergedBBox = mergeBBoxes(entry.bboxes);
			cells.push({
				text: entry.texts.join(' ').trim(),
				bbox: mergedBBox,
				column: col,
				rowspan: 1,
				colspan: 1,
				isHeader: false,
				confidence: columnRanges ? 0.9 : 0.7,
				ambiguous: false,
			});
		}

		cells.sort((a, b) => a.column - b.column);

		tableRows.push({
			index: rowIdx,
			isHeader: false,
			cells,
		});
	}

	detectHeaders(tableRows);
	return tableRows;
}

/**
 * Build one table region from items that already form a single region.
 *
 * This deliberately does **not** re-run region discovery. The caller has
 * already established the item grouping via `discoverRegions`, and
 * re-partitioning an established region can split a table's own columns
 * (e.g. a wide last-column gutter) into separate regions — the source of the
 * dropped/split column defect. Returns null only when there is nothing to
 * build, so an empty result is always visible to the caller.
 */
export function buildRegion(
	items: TextItem[],
	regionIdx: number,
	pageNum: number,
	pageHeight: number,
	bbox: BBox,
): TableRegion | null {
	const textItems = items.filter(
		(it) => it.itemType === 'Text' && it.text.trim().length > 0,
	);
	if (textItems.length === 0) return null;

	const rows = buildTableRows(textItems, pageHeight);
	if (rows.length === 0) return null;

	return { id: regionIdx, page: pageNum, bbox, source: 'clustered', rows };
}

export function buildPageLayout(
	items: TextItem[],
	pageNum: number,
	pageWidth: number,
	pageHeight: number,
): PageLayout {
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
		return {
			page: pageNum,
			regions: [],
			titles: [],
			outsideText: textItems.map((it) => ({
				text: it.text.trim(),
				bbox: itemBBox(it, pageHeight),
				assigned: false,
			})),
			needsOcr: false,
		};
	}

	const regions: TableRegion[] = [];

	for (let regionIdx = 0; regionIdx < clusters.length; regionIdx++) {
		const cluster = clusters[regionIdx]!;
		const region = buildRegion(
			cluster.items,
			regionIdx,
			pageNum,
			pageHeight,
			[cluster.xMin, cluster.yMin, cluster.xMax, cluster.yMax],
		);
		if (region) regions.push(region);
	}

	const topRegionY = Math.min(...clusters.map((c) => c.yMin));
	const titles = identifyTitles(textItems, topRegionY, pageHeight);
	const outsideText = assignOutsideText(textItems, clusters, pageHeight);

	return {
		page: pageNum,
		regions,
		titles,
		outsideText,
		needsOcr: false,
	};
}

export function detectHeaders(rows: TableRow[]): void {
	if (rows.length === 0) return;

	const isNonNum = (r: TableRow) =>
		r.cells.length > 0 && r.cells.every((c) => {
			const s = c.text.replace(/[,.\s]/g, '');
			return s.length > 0 && !/^\d+$/.test(s);
		});

	const hasNum = (r: TableRow) =>
		r.cells.some((c) => /^\d+$/.test(c.text.replace(/[,.\s]/g, '')));

	if (!isNonNum(rows[0]!)) return;

	rows[0]!.isHeader = true;
	for (const cell of rows[0]!.cells) cell.isHeader = true;

	const maxHeaderRows = Math.min(rows.length - 1, 3);
	for (let i = 1; i < maxHeaderRows; i++) {
		const row = rows[i]!;
		if (!isNonNum(row)) break;

		const followedByNumbers = rows.slice(i + 1, Math.min(rows.length, i + 5)).some(hasNum);
		if (followedByNumbers || row.cells.length < rows[0]!.cells.length) {
			row.isHeader = true;
			for (const cell of row.cells) cell.isHeader = true;
		} else {
			break;
		}
	}
}
