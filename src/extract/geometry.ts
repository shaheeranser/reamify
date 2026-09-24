import type { TextItem } from '@firecrawl/pdf-inspector';
import type { BBox } from '../types.js';

/**
 * Convert a TextItem's lower-left-origin y to top-left-origin y.
 * TextItem.y is the baseline from the bottom; we need y from top.
 */
export function toTopLeftY(item: TextItem, pageHeight: number): number {
	return pageHeight - item.y;
}

/**
 * Build a top-left-origin BBox for a TextItem.
 */
export function itemBBox(item: TextItem, pageHeight: number): BBox {
	const topY = pageHeight - item.y - item.height;
	return [item.x, topY, item.x + item.width, topY + item.height];
}

/** Merge multiple BBoxes into their union. */
export function mergeBBoxes(bboxes: BBox[]): BBox {
	if (bboxes.length === 0) return [0, 0, 0, 0];
	let [x1, y1, x2, y2] = bboxes[0]!;
	for (let i = 1; i < bboxes.length; i++) {
		const b = bboxes[i]!;
		x1 = Math.min(x1, b[0]);
		y1 = Math.min(y1, b[1]);
		x2 = Math.max(x2, b[2]);
		y2 = Math.max(y2, b[3]);
	}
	return [x1, y1, x2, y2];
}
