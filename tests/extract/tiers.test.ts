import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextItem } from '@firecrawl/pdf-inspector';

const mocks = vi.hoisted(() => ({
	detectVectorGridInRegion: vi.fn(() => null),
	extractTablesWithStructureCells: vi.fn(() => []),
	extractTablesInRegions: vi.fn(() => [{
		page: 0,
		regions: [
			{ text: '| A | B |\n|---|---|\n| 1 | 2 |', needsOcr: false },
			{ text: '| C | D |\n|---|---|\n| 3 | 4 |', needsOcr: false },
		],
	}]),
}));

vi.mock('@firecrawl/pdf-inspector', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@firecrawl/pdf-inspector')>();
	return {
		...actual,
		detectVectorGridInRegion: mocks.detectVectorGridInRegion,
		extractTablesWithStructureCells: mocks.extractTablesWithStructureCells,
		extractTablesInRegions: mocks.extractTablesInRegions,
	};
});

import { extractPageLayout } from '../../src/extract/tiers.js';

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

describe('extractPageLayout', () => {
	beforeEach(() => {
		mocks.detectVectorGridInRegion.mockClear();
		mocks.extractTablesWithStructureCells.mockClear();
		mocks.extractTablesInRegions.mockClear();
	});

	it('batches region table extraction across all regions on the same page', () => {
		const items = [
			...Array.from({ length: 3 }, (_, i) =>
				makeItem({ x: 30 + i * 80, y: 700, text: `L${i}`, width: 60 }),
			),
			...Array.from({ length: 3 }, (_, i) =>
				makeItem({ x: 330 + i * 80, y: 700, text: `R${i}`, width: 60 }),
			),
		];

		extractPageLayout(Buffer.from('dummy'), items, 0, 640, 800, 'auto');

		expect(mocks.detectVectorGridInRegion).toHaveBeenCalledTimes(2);
		expect(mocks.extractTablesWithStructureCells).not.toHaveBeenCalled();
		expect(mocks.extractTablesInRegions).toHaveBeenCalledTimes(1);
		const pageRegions = mocks.extractTablesInRegions.mock.calls[0]![1];
		expect(pageRegions).toHaveLength(1);
		expect(pageRegions[0]!.regions).toHaveLength(2);
	});

	it('clustered mode skips every native table call and still emits regions', () => {
		const items = [
			...Array.from({ length: 3 }, (_, i) =>
				makeItem({ x: 30 + i * 80, y: 700, text: `L${i}`, width: 60 }),
			),
			...Array.from({ length: 3 }, (_, i) =>
				makeItem({ x: 330 + i * 80, y: 700, text: `R${i}`, width: 60 }),
			),
		];

		const layout = extractPageLayout(Buffer.from('dummy'), items, 0, 640, 800, 'clustered');

		expect(mocks.detectVectorGridInRegion).not.toHaveBeenCalled();
		expect(mocks.extractTablesWithStructureCells).not.toHaveBeenCalled();
		expect(mocks.extractTablesInRegions).not.toHaveBeenCalled();
		expect(layout.regions).toHaveLength(2);
		for (const region of layout.regions) {
			expect(region.source).toBe('clustered');
		}
	});
});
