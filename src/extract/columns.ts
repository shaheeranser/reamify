import type { BaselineRow } from './rows.js';

const MIN_COLUMN_GAP_PT = 3;

/**
 * A column range defined by left and right x-boundaries in PDF points.
 * Items whose horizontal extent falls within [left, right) belong to
 * this logical column.
 */
export interface ColumnRange {
	left: number;
	right: number;
}

/**
 * Derive logical column ranges from header row token positions.
 *
 * Header tokens are consistently positioned regardless of text alignment
 * (left, center, or right), so their spans define stable column anchors.
 * The range boundaries are set at the midpoints between adjacent header
 * tokens, with the first range extending to -Infinity and the last to
 * +Infinity.
 *
 * Falls back to the legacy `inferColumnBoundaries` clustering when no
 * header rows can be identified.
 */
export function inferColumnRanges(rows: BaselineRow[]): ColumnRange[] | null {
	if (rows.length === 0) return null;

	// Identify candidate header rows: the first consecutive rows where
	// every item is non-numeric text.
	const headerRows: BaselineRow[] = [];
	for (const row of rows) {
		const allNonNum = row.items.length > 0 && row.items.every((it) => {
			const s = it.text.replace(/[,.\s]/g, '');
			return s.length > 0 && !/^\d+$/.test(s);
		});
		if (allNonNum) {
			headerRows.push(row);
		} else {
			break;
		}
	}

	if (headerRows.length === 0) return null;

	// Collect all header token spans [x, x + width], then cluster them
	// by position to get one representative span per logical column.
	const spans: Array<{ left: number; right: number }> = [];
	for (const row of headerRows) {
		for (const item of row.items) {
			spans.push({ left: item.x, right: item.x + item.width });
		}
	}

	if (spans.length === 0) return null;

	// Sort spans by left edge
	spans.sort((a, b) => a.left - b.left);

	// Cluster overlapping or very close spans into logical columns.
	// Two spans belong to the same logical column if they overlap or
	// their gap is smaller than MIN_COLUMN_GAP_PT.
	const merged: Array<{ left: number; right: number }> = [{ ...spans[0]! }];
	for (let i = 1; i < spans.length; i++) {
		const span = spans[i]!;
		const last = merged[merged.length - 1]!;
		if (span.left <= last.right + MIN_COLUMN_GAP_PT) {
			// Merge: extend the right edge
			last.left = Math.min(last.left, span.left);
			last.right = Math.max(last.right, span.right);
		} else {
			merged.push({ ...span });
		}
	}

	if (merged.length < 2) return null;

	// Build column ranges using midpoints between adjacent merged spans.
	const ranges: ColumnRange[] = [];
	for (let i = 0; i < merged.length; i++) {
		const leftBound = i === 0
			? -Infinity
			: (merged[i - 1]!.right + merged[i]!.left) / 2;
		const rightBound = i === merged.length - 1
			? Infinity
			: (merged[i]!.right + merged[i + 1]!.left) / 2;
		ranges.push({ left: leftBound, right: rightBound });
	}

	return ranges;
}

/**
 * Assign an item to a logical column using header-derived ranges.
 * Uses the item's horizontal center for matching.
 */
export function assignColumnByRange(
	itemX: number,
	itemWidth: number,
	ranges: ColumnRange[],
): number {
	if (ranges.length === 0) return 0;
	const center = itemX + itemWidth / 2;
	for (let i = 0; i < ranges.length; i++) {
		if (center >= ranges[i]!.left && center < ranges[i]!.right) {
			return i;
		}
	}
	// Fallback: assign to nearest range
	let bestIdx = 0;
	let bestDist = Infinity;
	for (let i = 0; i < ranges.length; i++) {
		const rangeCenter = (
			(ranges[i]!.left === -Infinity ? ranges[i]!.right - 50 : ranges[i]!.left) +
			(ranges[i]!.right === Infinity ? ranges[i]!.left + 50 : ranges[i]!.right)
		) / 2;
		const dist = Math.abs(center - rangeCenter);
		if (dist < bestDist) {
			bestDist = dist;
			bestIdx = i;
		}
	}
	return bestIdx;
}

// ---------------------------------------------------------------------------
// Legacy clustering (retained as fallback)
// ---------------------------------------------------------------------------

export function inferColumnBoundaries(rows: BaselineRow[]): number[] {
	if (rows.length === 0) return [];

	const allStarts: number[] = [];
	for (const row of rows) {
		for (const item of row.items) {
			allStarts.push(item.x);
		}
	}

	if (allStarts.length === 0) return [];

	allStarts.sort((a, b) => a - b);

	const clusters: Array<{ representative: number; count: number }> = [];
	let current = { representative: allStarts[0]!, sum: allStarts[0]!, count: 1 };

	for (let i = 1; i < allStarts.length; i++) {
		const x = allStarts[i]!;
		if (x - current.representative <= MIN_COLUMN_GAP_PT) {
			current.sum += x;
			current.count++;
			current.representative = current.sum / current.count;
		} else {
			clusters.push({ representative: current.representative, count: current.count });
			current = { representative: x, sum: x, count: 1 };
		}
	}
	clusters.push({ representative: current.representative, count: current.count });

	const minOccurrences = Math.max(2, Math.floor(rows.length * 0.15));
	const stableClusters = clusters.filter((c) => c.count >= minOccurrences);

	const finalClusters = stableClusters.length > 0 ? stableClusters : clusters;

	return finalClusters.map((c) => c.representative).sort((a, b) => a - b);
}

export function assignColumn(itemX: number, columnBoundaries: number[]): number {
	if (columnBoundaries.length === 0) return 0;
	if (itemX <= columnBoundaries[0]!) return 0;
	const lastIdx = columnBoundaries.length - 1;
	if (itemX >= columnBoundaries[lastIdx]!) return lastIdx;

	for (let i = 0; i < lastIdx; i++) {
		const midpoint = (columnBoundaries[i]! + columnBoundaries[i + 1]!) / 2;
		if (itemX < midpoint) {
			return i;
		}
	}
	return lastIdx;
}
