import { describe, it, expect } from 'vitest';
import type { TextItem } from '@firecrawl/pdf-inspector';
import { clusterRows } from '../../src/extract/rows.js';

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

const PAGE_HEIGHT = 792;

describe('clusterRows', () => {
	it('groups items at the same y into one row', () => {
		const items = [
			makeItem({ x: 50, y: 700, text: 'A' }),
			makeItem({ x: 150, y: 700, text: 'B' }),
			makeItem({ x: 250, y: 700, text: 'C' }),
		];

		const rows = clusterRows(items, PAGE_HEIGHT);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.items).toHaveLength(3);
	});

	it('separates items at different y levels', () => {
		const items = [
			makeItem({ x: 50, y: 700, text: 'Row1-A' }),
			makeItem({ x: 150, y: 700, text: 'Row1-B' }),
			makeItem({ x: 50, y: 670, text: 'Row2-A' }),
			makeItem({ x: 150, y: 670, text: 'Row2-B' }),
			makeItem({ x: 50, y: 640, text: 'Row3-A' }),
		];

		const rows = clusterRows(items, PAGE_HEIGHT);
		expect(rows).toHaveLength(3);
	});

	it('tolerates small y variations within a row', () => {
		const items = [
			makeItem({ x: 50, y: 700, text: 'A' }),
			makeItem({ x: 150, y: 701, text: 'B' }), // 1pt off
			makeItem({ x: 250, y: 699, text: 'C' }), // 1pt off
		];

		const rows = clusterRows(items, PAGE_HEIGHT);
		expect(rows).toHaveLength(1);
	});

	it('sorts items within a row by x coordinate', () => {
		const items = [
			makeItem({ x: 250, y: 700, text: 'C' }),
			makeItem({ x: 50, y: 700, text: 'A' }),
			makeItem({ x: 150, y: 700, text: 'B' }),
		];

		const rows = clusterRows(items, PAGE_HEIGHT);
		expect(rows[0]!.items.map((i) => i.text)).toEqual(['A', 'B', 'C']);
	});
});
