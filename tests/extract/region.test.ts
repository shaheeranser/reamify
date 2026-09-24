import { describe, it, expect } from 'vitest';
import type { TextItem } from '@firecrawl/pdf-inspector';
import { discoverRegions } from '../../src/extract/region.js';

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

describe('discoverRegions', () => {
	it('discovers a single region for a simple table (matrix case 1)', () => {
		const items = [
			makeItem({ x: 50, y: 700, text: 'Header1' }),
			makeItem({ x: 150, y: 700, text: 'Header2' }),
			makeItem({ x: 250, y: 700, text: 'Header3' }),
			makeItem({ x: 50, y: 680, text: 'Data1' }),
			makeItem({ x: 150, y: 680, text: 'Data2' }),
			makeItem({ x: 250, y: 680, text: 'Data3' }),
		];

		const regions = discoverRegions(items, PAGE_WIDTH, PAGE_HEIGHT);
		expect(regions).toHaveLength(1);
		expect(regions[0]!.items).toHaveLength(6);
	});

	it('discovers two side-by-side regions (matrix case 2)', () => {
		const leftItems = [
			makeItem({ x: 30, y: 700, text: 'L-H1', width: 40 }),
			makeItem({ x: 80, y: 700, text: 'L-H2', width: 40 }),
			makeItem({ x: 130, y: 700, text: 'L-H3', width: 40 }),
			makeItem({ x: 30, y: 680, text: 'L-D1', width: 40 }),
			makeItem({ x: 80, y: 680, text: 'L-D2', width: 40 }),
			makeItem({ x: 130, y: 680, text: 'L-D3', width: 40 }),
		];

		const rightItems = [
			makeItem({ x: 330, y: 700, text: 'R-H1', width: 40 }),
			makeItem({ x: 380, y: 700, text: 'R-H2', width: 40 }),
			makeItem({ x: 430, y: 700, text: 'R-H3', width: 40 }),
			makeItem({ x: 330, y: 680, text: 'R-D1', width: 40 }),
			makeItem({ x: 380, y: 680, text: 'R-D2', width: 40 }),
			makeItem({ x: 430, y: 680, text: 'R-D3', width: 40 }),
		];

		const regions = discoverRegions([...leftItems, ...rightItems], PAGE_WIDTH, PAGE_HEIGHT);
		expect(regions).toHaveLength(2);
		expect(regions[0]!.xMin).toBeLessThan(regions[1]!.xMin);
	});

	it('discovers three side-by-side regions (matrix case 3)', () => {
		const makeCluster = (baseX: number, label: string) => [
			makeItem({ x: baseX, y: 700, text: `${label}-H1`, width: 30 }),
			makeItem({ x: baseX + 40, y: 700, text: `${label}-H2`, width: 30 }),
			makeItem({ x: baseX, y: 680, text: `${label}-D1`, width: 30 }),
			makeItem({ x: baseX + 40, y: 680, text: `${label}-D2`, width: 30 }),
		];

		const items = [
			...makeCluster(20, 'A'),
			...makeCluster(200, 'B'),
			...makeCluster(400, 'C'),
		];

		const regions = discoverRegions(items, PAGE_WIDTH, PAGE_HEIGHT);
		expect(regions).toHaveLength(3);
		expect(regions[0]!.xMin).toBeLessThan(regions[1]!.xMin);
		expect(regions[1]!.xMin).toBeLessThan(regions[2]!.xMin);
	});

	it('returns empty for no items', () => {
		expect(discoverRegions([], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
	});

	it('handles items with no significant gaps as single region', () => {
		const items = Array.from({ length: 20 }, (_, i) =>
			makeItem({ x: 50 + i * 25, y: 700, text: `C${i}`, width: 20 }),
		);

		const regions = discoverRegions(items, PAGE_WIDTH, PAGE_HEIGHT);
		expect(regions).toHaveLength(1);
	});

	it('does not sever a column when intra-table gutters are uneven (regression)', () => {
		// Two 5-column tables. Gutters in x-order: the left table's four
		// gutters, the inter-table gap, then the right table's four gutters.
		// The widest intra-table gutter (23.93) sits just above the absolute
		// floor (551.7 * 0.04 = 22.07), which is enough to fool a
		// median-derived threshold into treating it as a region boundary and
		// splitting the last column off its own table.
		const gapSequence = [14.0, 14.45, 10.92, 23.93, 37.95, 13.76, 21.96, 10.92, 22.14];
		const xs = [0];
		for (let i = 0; i < gapSequence.length; i++) {
			xs.push(+(xs[i]! + 2 + gapSequence[i]!).toFixed(2));
		}
		const items = xs.map((x, i) => makeItem({ x, y: 700, text: `T${i}`, width: 2 }));

		const regions = discoverRegions(items, 551.7, PAGE_HEIGHT);
		expect(regions).toHaveLength(2);
		expect(regions[0]!.items).toHaveLength(5);
		expect(regions[1]!.items).toHaveLength(5);
	});

	it('keeps a uniform-gutter table as a single region (no discontinuity to split on)', () => {
		const items = Array.from({ length: 10 }, (_, i) =>
			makeItem({ x: i * 12, y: 700, text: `U${i}`, width: 2 }),
		);

		const regions = discoverRegions(items, 551.7, PAGE_HEIGHT);
		expect(regions).toHaveLength(1);
	});
});
