import { describe, it, expect } from 'vitest';
import type { TextItem } from '@firecrawl/pdf-inspector';
import { toTopLeftY, itemBBox } from '../../src/extract/geometry.js';

function makeItem(overrides: Partial<TextItem> & { x: number; y: number; text: string }): TextItem {
	return {
		width: overrides.width ?? 50,
		height: overrides.height ?? 12,
		rotation: 0,
		advanceKnown: true,
		font: 'TestFont',
		fontTag: 'F1',
		fontSize: 10,
		page: overrides.page ?? 1,
		isBold: overrides.isBold ?? false,
		isItalic: false,
		isUnderline: false,
		isStrikeout: false,
		baselineShift: 0,
		itemType: 'Text' as const,
		...overrides,
	} as TextItem;
}

describe('coordinate helpers', () => {
	it('converts y from bottom-left to top-left origin', () => {
		const item = makeItem({ x: 100, y: 700, text: 'test' });
		const topY = toTopLeftY(item, 792);
		expect(topY).toBe(92);
	});

	it('computes item bounding box in top-left origin', () => {
		const item = makeItem({ x: 100, y: 700, text: 'test', width: 50, height: 12 });
		const bbox = itemBBox(item, 792);
		expect(bbox).toEqual([100, 80, 150, 92]);
	});
});
