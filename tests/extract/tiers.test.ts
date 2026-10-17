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

	function tableItems(): TextItem[] {
		return [
			makeItem({ x: 30, y: 700, text: 'Name', width: 60 }),
			makeItem({ x: 200, y: 700, text: 'Amount', width: 60 }),
			makeItem({ x: 30, y: 680, text: 'Alice', width: 60 }),
			makeItem({ x: 200, y: 680, text: '10', width: 60 }),
		];
	}

	it('rejects an incomplete native region-table result and keeps the clustered baseline', () => {
		const warnings: Array<{ kind: string }> = [];
		mocks.extractTablesInRegions.mockReturnValueOnce([
			{ page: 0, regions: [{ text: '| Name | Amount |', needsOcr: false }] },
		]);

		const layout = extractPageLayout(
			Buffer.from('dummy'),
			tableItems(),
			0,
			640,
			800,
			'auto',
			(w) => warnings.push(w),
		);

		expect(layout.regions).toHaveLength(1);
		expect(layout.regions[0]!.source).toBe('clustered');
		const emitted = layout.regions[0]!.rows.flatMap((row) => row.cells.map((cell) => cell.text)).join(' ');
		expect(emitted).toContain('Alice');
		expect(emitted).toContain('10');
		expect(warnings.some((w) => w.kind === 'tier-incomplete')).toBe(true);
	});

	it('accepts a native region-table result that retains all of the cluster text', () => {
		const warnings: Array<{ kind: string }> = [];
		mocks.extractTablesInRegions.mockReturnValueOnce([
			{ page: 0, regions: [{ text: '| Name | Amount |\n|---|---|\n| Alice | 10 |', needsOcr: false }] },
		]);

		const layout = extractPageLayout(
			Buffer.from('dummy'),
			tableItems(),
			0,
			640,
			800,
			'auto',
			(w) => warnings.push(w),
		);

		expect(layout.regions).toHaveLength(1);
		expect(layout.regions[0]!.source).toBe('region-tables');
		expect(warnings.some((w) => w.kind === 'tier-incomplete')).toBe(false);
	});
});
