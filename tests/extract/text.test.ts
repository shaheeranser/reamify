import { describe, it, expect } from 'vitest';
import type { TextItem } from '@firecrawl/pdf-inspector';
import { identifyTitles, assignOutsideText } from '../../src/extract/text.js';

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

describe('identifyTitles', () => {
	it('identifies bold text above regions as titles', () => {
		const items = [
			makeItem({ x: 50, y: 750, text: 'Table Title', isBold: true }),
			makeItem({ x: 50, y: 700, text: 'Data row' }),
		];

		const titles = identifyTitles(items, 80, PAGE_HEIGHT);
		expect(titles).toHaveLength(1);
		expect(titles[0]!.text).toBe('Table Title');
		expect(titles[0]!.isBold).toBe(true);
	});

	it('returns empty when no text is above regions', () => {
		const items = [makeItem({ x: 50, y: 700, text: 'In region' })];
		const titles = identifyTitles(items, 80, PAGE_HEIGHT);
		expect(titles).toHaveLength(0);
	});
});

describe('assignOutsideText', () => {
	it('marks text within region x-range as assigned', () => {
		const items = [
			makeItem({ x: 100, y: 500, text: 'trailing value' }),
		];
		const regions = [{ items: [], xMin: 50, xMax: 200, yMin: 80, yMax: 120 }];

		const result = assignOutsideText(items, regions, PAGE_HEIGHT);
		expect(result).toHaveLength(1);
		expect(result[0]!.assigned).toBe(true);
	});

	it('marks text outside all region x-ranges as unassigned', () => {
		const items = [
			makeItem({ x: 400, y: 500, text: 'orphan text' }),
		];
		const regions = [{ items: [], xMin: 50, xMax: 200, yMin: 80, yMax: 120 }];

		const result = assignOutsideText(items, regions, PAGE_HEIGHT);
		expect(result).toHaveLength(1);
		expect(result[0]!.assigned).toBe(false);
	});
});
