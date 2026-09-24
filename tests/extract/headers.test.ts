import { describe, it, expect } from 'vitest';
import type { TextItem } from '@firecrawl/pdf-inspector';
import { buildPageLayout, buildRegion } from '../../src/extract/headers.js';

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

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;

describe('buildPageLayout', () => {
	it('builds layout with correct cell text (no splitting) (matrix case 5)', () => {
		const items = [
			makeItem({ x: 50, y: 700, text: 'Orangi 1 Liaqatabad', width: 120 }),
			makeItem({ x: 200, y: 700, text: '10,013', width: 40 }),
			makeItem({ x: 50, y: 680, text: 'Above 3 Years', width: 120 }),
			makeItem({ x: 200, y: 680, text: '62,383', width: 40 }),
		];

		const layout = buildPageLayout(items, 0, PAGE_WIDTH, PAGE_HEIGHT);
		expect(layout.regions).toHaveLength(1);

		const region = layout.regions[0]!;
		const allTexts = region.rows.flatMap((r) => r.cells.map((c) => c.text));
		expect(allTexts).toContain('Orangi 1 Liaqatabad');
		expect(allTexts).toContain('10,013');
	});

	it('returns empty regions for no items', () => {
		const layout = buildPageLayout([], 0, PAGE_WIDTH, PAGE_HEIGHT);
		expect(layout.regions).toHaveLength(0);
	});

	it('handles non-table prose without creating phantom tables (matrix case 7)', () => {
		const items = [
			makeItem({ x: 50, y: 700, text: 'This is a paragraph of text.', width: 200 }),
			makeItem({ x: 50, y: 680, text: 'It continues on the next line.', width: 200 }),
		];

		const layout = buildPageLayout(items, 0, PAGE_WIDTH, PAGE_HEIGHT);
		expect(layout.regions.length).toBeGreaterThanOrEqual(0);
		expect(layout.regions.length).toBeLessThanOrEqual(1);
	});

	it('preserves page number in layout', () => {
		const items = [makeItem({ x: 50, y: 700, text: 'test' })];
		const layout = buildPageLayout(items, 42, PAGE_WIDTH, PAGE_HEIGHT);
		expect(layout.page).toBe(42);
	});
});

describe('buildRegion', () => {
	it('keeps a table as one region even when its last gutter is the largest gap', () => {
		// One 5-column table. Gutters in x-order: 14.0, 14.45, 10.92, 23.93.
		// The 23.93pt last gutter is a strong relative discontinuity *within*
		// this table but is not a region boundary; re-running region discovery
		// here used to split it off and drop it.
		const gaps = [14.0, 14.45, 10.92, 23.93];
		const xs = [0];
		for (let i = 0; i < gaps.length; i++) xs.push(+(xs[i]! + 12 + gaps[i]!).toFixed(2));

		const headerText = ['Contract No', 'IBC Name', 'Payment Slab', 'Outstanding Dues', 'Disconnections'];
		const items = [
			...xs.map((x, i) => makeItem({ x, y: 700, text: headerText[i]!, width: 10 })),
			...xs.map((x, i) => makeItem({ x, y: 680, text: `${1000 + i}`, width: 10 })),
			...xs.map((x, i) => makeItem({ x, y: 660, text: `${2000 + i}`, width: 10 })),
		];

		const region = buildRegion(items, 0, 0, PAGE_HEIGHT, [0, 0, 100, 100]);
		expect(region).not.toBeNull();

		let maxCol = 0;
		for (const row of region!.rows) for (const c of row.cells) maxCol = Math.max(maxCol, c.column + 1);
		expect(maxCol).toBe(5);
		expect(region!.rows).toHaveLength(3);
	});

	it('returns null for items with no text', () => {
		expect(buildRegion([], 0, 0, PAGE_HEIGHT, [0, 0, 0, 0])).toBeNull();
	});
});
