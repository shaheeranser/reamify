import type { TextItem } from '@firecrawl/pdf-inspector';
import { toTopLeftY } from './geometry.js';

export interface BaselineRow {
	y: number;
	items: TextItem[];
}

const ROW_BASELINE_TOLERANCE_FACTOR = 0.6;

export function clusterRows(
	items: TextItem[],
	pageHeight: number,
): BaselineRow[] {
	if (items.length === 0) return [];

	const heights = items.map((it) => it.height).sort((a, b) => a - b);
	const medianHeight = heights[Math.floor(heights.length / 2)] ?? 10;
	const tolerance = medianHeight * ROW_BASELINE_TOLERANCE_FACTOR;

	const byY = [...items].sort(
		(a, b) => toTopLeftY(a, pageHeight) - toTopLeftY(b, pageHeight),
	);

	const rows: BaselineRow[] = [];
	let currentRow: BaselineRow | null = null;

	for (const item of byY) {
		const y = toTopLeftY(item, pageHeight);

		if (currentRow === null || Math.abs(y - currentRow.y) > tolerance) {
			currentRow = { y, items: [item] };
			rows.push(currentRow);
		} else {
			currentRow.items.push(item);
			currentRow.y =
				(currentRow.y * (currentRow.items.length - 1) + y) /
				currentRow.items.length;
		}
	}

	for (const row of rows) {
		row.items.sort((a, b) => a.x - b.x);
	}

	return rows;
}
