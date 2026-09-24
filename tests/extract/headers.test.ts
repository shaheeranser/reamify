import { describe, it, expect } from 'vitest';
import type { TextItem } from '@firecrawl/pdf-inspector';
import { buildPageLayout } from '../../src/extract/headers.js';

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
