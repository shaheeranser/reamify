import { describe, it, expect } from 'vitest';
import type { TextItem } from '@firecrawl/pdf-inspector';
import {
	inferColumnBoundaries,
	assignColumn,
	inferColumnRanges,
	assignColumnByRange,
} from '../../src/extract/columns.js';

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

describe('inferColumnBoundaries', () => {
	it('infers column boundaries from repeated x positions', () => {
		const rows = [
			{ y: 92, items: [
				makeItem({ x: 50, y: 700, text: 'A1' }),
				makeItem({ x: 150, y: 700, text: 'A2' }),
				makeItem({ x: 250, y: 700, text: 'A3' }),
			]},
			{ y: 112, items: [
				makeItem({ x: 50, y: 680, text: 'B1' }),
				makeItem({ x: 150, y: 680, text: 'B2' }),
				makeItem({ x: 250, y: 680, text: 'B3' }),
			]},
			{ y: 132, items: [
				makeItem({ x: 50, y: 660, text: 'C1' }),
				makeItem({ x: 150, y: 660, text: 'C2' }),
				makeItem({ x: 250, y: 660, text: 'C3' }),
			]},
		];

		const boundaries = inferColumnBoundaries(rows);
		expect(boundaries).toHaveLength(3);
		expect(boundaries[0]).toBeCloseTo(50, 0);
		expect(boundaries[1]).toBeCloseTo(150, 0);
		expect(boundaries[2]).toBeCloseTo(250, 0);
	});

	it('returns empty for empty rows', () => {
		expect(inferColumnBoundaries([])).toHaveLength(0);
	});
});

describe('assignColumn', () => {
	it('assigns item to correct column', () => {
		const boundaries = [50, 150, 250];
		expect(assignColumn(55, boundaries)).toBe(0);
		expect(assignColumn(160, boundaries)).toBe(1);
		expect(assignColumn(260, boundaries)).toBe(2);
	});

	it('assigns to column 0 when left of all boundaries', () => {
		expect(assignColumn(10, [50, 150])).toBe(0);
	});

	it('handles empty boundaries', () => {
		expect(assignColumn(100, [])).toBe(0);
	});

	it('separates closely spaced columns using midpoint partitioning (D3)', () => {
		const boundaries = [350, 400];
		// Midpoint is 375
		expect(assignColumn(365, boundaries)).toBe(0);
		expect(assignColumn(380, boundaries)).toBe(1);
	});

	it('distinguishes columns separated by 4pt (D3)', () => {
		const rows = [
			{ y: 100, items: [makeItem({ x: 350, y: 700, text: 'A' }), makeItem({ x: 354, y: 700, text: 'B' })] },
			{ y: 120, items: [makeItem({ x: 350, y: 680, text: 'C' }), makeItem({ x: 354, y: 680, text: 'D' })] },
		];
		const boundaries = inferColumnBoundaries(rows);
		expect(boundaries).toHaveLength(2);
		expect(boundaries[0]).toBeCloseTo(350, 0);
		expect(boundaries[1]).toBeCloseTo(354, 0);
	});
});

describe('inferColumnRanges', () => {
	it('derives column ranges from header row tokens', () => {
		// Simulate: header row with 3 well-spaced columns
		const rows = [
			// Header row (all text, no numbers)
			{ y: 92, items: [
				makeItem({ x: 50, y: 700, text: 'Contract No', width: 23 }),
				makeItem({ x: 151, y: 700, text: 'IBC Name', width: 19 }),
				makeItem({ x: 250, y: 700, text: 'Amount', width: 18 }),
			]},
			// Data rows with numbers
			{ y: 112, items: [
				makeItem({ x: 50, y: 680, text: '12345', width: 19 }),
				makeItem({ x: 156, y: 680, text: 'Uthal', width: 10 }),
				makeItem({ x: 252, y: 680, text: '100', width: 8 }),
			]},
		];

		const ranges = inferColumnRanges(rows);
		expect(ranges).not.toBeNull();
		expect(ranges).toHaveLength(3);
	});

	it('returns null when no header rows are found', () => {
		const rows = [
			{ y: 92, items: [
				makeItem({ x: 50, y: 700, text: '12345', width: 19 }),
				makeItem({ x: 150, y: 700, text: '67890', width: 19 }),
			]},
		];
		expect(inferColumnRanges(rows)).toBeNull();
	});

	it('returns null for empty rows', () => {
		expect(inferColumnRanges([])).toBeNull();
	});
});

describe('assignColumnByRange — center-aligned IBC Name fix', () => {
	it('assigns all center-aligned IBC names to the same column', () => {
		// Simulate the Defaulters List layout for the left table block.
		// Header tokens define 5 columns.
		const rows = [
			// Header row
			{ y: 92, items: [
				makeItem({ x: 113.4, y: 723, text: 'Contract No', width: 23.05 }),
				makeItem({ x: 151.4, y: 723, text: 'IBC Name', width: 19.17 }),
				makeItem({ x: 185.0, y: 723, text: 'Payment Slab', width: 26.23 }),
				makeItem({ x: 222.2, y: 726, text: 'Outstanding Dues', width: 35.16 }),
				makeItem({ x: 268.9, y: 726, text: 'Disconnections', width: 30.92 }),
			]},
			// Data row 1: "Uthal" starts at x=156 (short name, center-aligned)
			{ y: 112, items: [
				makeItem({ x: 115.3, y: 708, text: '32933398', width: 19.12 }),
				makeItem({ x: 156.0, y: 708, text: 'Uthal', width: 10.12 }),
				makeItem({ x: 185.4, y: 708, text: 'Above 3 Years', width: 25.92 }),
				makeItem({ x: 233.0, y: 708, text: '78,267', width: 13.18 }),
				makeItem({ x: 283.1, y: 708, text: '1', width: 2.37 }),
			]},
			// Data row 2: "North Karachi" starts at x=148 (long name)
			{ y: 122, items: [
				makeItem({ x: 115.3, y: 689, text: '32891180', width: 19.12 }),
				makeItem({ x: 148.2, y: 689, text: 'North Karachi', width: 25.62 }),
				makeItem({ x: 185.4, y: 689, text: 'Above 3 Years', width: 25.92 }),
				makeItem({ x: 233.0, y: 689, text: '78,380', width: 13.18 }),
				makeItem({ x: 283.1, y: 689, text: '1', width: 2.37 }),
			]},
			// Data row 3: "Bin Qasim" starts at x=151 (medium name)
			{ y: 132, items: [
				makeItem({ x: 115.3, y: 682, text: '30327995', width: 19.12 }),
				makeItem({ x: 151.4, y: 682, text: 'Bin Qasim', width: 20.44 }),
				makeItem({ x: 185.4, y: 682, text: 'Above 3 Years', width: 25.92 }),
				makeItem({ x: 233.0, y: 682, text: '78,408', width: 13.18 }),
				makeItem({ x: 283.1, y: 682, text: '1', width: 2.37 }),
			]},
		];

		const ranges = inferColumnRanges(rows);
		expect(ranges).not.toBeNull();
		expect(ranges).toHaveLength(5);

		// All three IBC name variants should land in column 1:
		// "Uthal" at x=156, w=10.12 → center=161.06
		expect(assignColumnByRange(156.0, 10.12, ranges!)).toBe(1);
		// "North Karachi" at x=148.2, w=25.62 → center=161.01
		expect(assignColumnByRange(148.2, 25.62, ranges!)).toBe(1);
		// "Bin Qasim" at x=151.4, w=20.44 → center=161.62
		expect(assignColumnByRange(151.4, 20.44, ranges!)).toBe(1);

		// And the other columns should still be correct:
		// Contract No: x=115.3, w=19.12 → center=124.86
		expect(assignColumnByRange(115.3, 19.12, ranges!)).toBe(0);
		// Payment Slab: x=185.4, w=25.92 → center=198.36
		expect(assignColumnByRange(185.4, 25.92, ranges!)).toBe(2);
		// Outstanding Dues: x=233.0, w=13.18 → center=239.59
		expect(assignColumnByRange(233.0, 13.18, ranges!)).toBe(3);
		// Disconnections: x=283.1, w=2.37 → center=284.285
		expect(assignColumnByRange(283.1, 2.37, ranges!)).toBe(4);
	});
});

