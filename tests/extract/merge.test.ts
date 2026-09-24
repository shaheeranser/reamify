import { describe, it, expect } from 'vitest';
import { mergeTableRegions, mergeTableRegionsWithReport, headerBlockSignature } from '../../src/extract/merge.js';
import type { PageLayout, TableRegion, TableRow, TableCell, BBox } from '../../src/types.js';

function makeCell(text: string, col: number, isHeader = false): TableCell {
	return {
		text,
		bbox: [0, 0, 0, 0] as BBox,
		column: col,
		rowspan: 1,
		colspan: 1,
		isHeader,
		confidence: 1.0,
		ambiguous: false,
	};
}

function makeRow(cells: TableCell[], index: number, isHeader = false): TableRow {
	return { index, isHeader, cells };
}

function makeRegion(
	id: number,
	page: number,
	bbox: BBox,
	rows: TableRow[],
): TableRegion {
	return {
		id,
		page,
		bbox,
		source: 'clustered',
		rows,
	};
}

function makeLayout(
	page: number,
	regions: TableRegion[],
	titles: Array<{ text: string; bbox: BBox; isBold: boolean }> = [],
	outsideText: Array<{ text: string; bbox: BBox; assigned: boolean }> = [],
): PageLayout {
	return {
		page,
		regions,
		titles,
		outsideText,
		needsOcr: false,
	};
}

describe('headerBlockSignature', () => {
	it('normalizes and concatenates multi-line headers column-by-column (D1 resilience)', () => {
		// Table 1: Line 1 has 'Payment Slab', Line 2 empty for that col
		const rows1: TableRow[] = [
			makeRow([
				makeCell('Contract No', 0, true),
				makeCell('IBC Name', 1, true),
				makeCell('Payment Slab', 2, true),
				makeCell('Outstanding Dues', 3, true),
			], 0, true),
			makeRow([
				makeCell('(April-26)', 3, true),
			], 1, true),
			makeRow([makeCell('12345', 0), makeCell('Uthal', 1)], 2, false),
		];

		// Table 2: Line 1 has 'Payment', Line 2 has 'Slab' due to wrapping jitter
		const rows2: TableRow[] = [
			makeRow([
				makeCell('Contract No', 0, true),
				makeCell('IBC Name', 1, true),
				makeCell('Payment', 2, true),
				makeCell('Outstanding', 3, true),
			], 0, true),
			makeRow([
				makeCell('Slab', 2, true),
				makeCell('Dues (April-26)', 3, true),
			], 1, true),
			makeRow([makeCell('67890', 0), makeCell('KIMZ', 1)], 2, false),
		];

		const sig1 = headerBlockSignature(rows1);
		const sig2 = headerBlockSignature(rows2);

		expect(sig1).toBe('contract no|ibc name|payment slab|outstanding dues (april-26)');
		expect(sig2).toBe('contract no|ibc name|payment slab|outstanding dues (april-26)');
		expect(sig1).toBe(sig2);
	});
});

describe('mergeTableRegions', () => {
	it('merges side-by-side horizontal table columns into a single region (spec case 1)', () => {
		const headerL = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('L-R1A', 0), makeCell('L-R1B', 1)], 1),
			makeRow([makeCell('L-R2A', 0), makeCell('L-R2B', 1)], 2),
		];
		const headerR = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('R-R1A', 0), makeCell('R-R1B', 1)], 1),
		];

		const layout = makeLayout(0, [
			makeRegion(0, 0, [50, 100, 250, 500], headerL),
			makeRegion(1, 0, [300, 100, 500, 500], headerR),
		]);

		const merged = mergeTableRegions([layout]);
		expect(merged[0]!.regions).toHaveLength(1);

		const reg = merged[0]!.regions[0]!;
		expect(reg.bbox).toEqual([50, 100, 500, 500]);
		// Should have 1 header row + 2 rows from Left + 1 row from Right = 4 rows
		expect(reg.rows).toHaveLength(4);
		expect(reg.rows[0]!.cells[0]!.text).toBe('Col A');
		expect(reg.rows[1]!.cells[0]!.text).toBe('L-R1A');
		expect(reg.rows[2]!.cells[0]!.text).toBe('L-R2A');
		expect(reg.rows[3]!.cells[0]!.text).toBe('R-R1A');
	});

	it('does NOT merge two identical tables separated by a text paragraph (spec case 2)', () => {
		const rowsL = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('L1', 0), makeCell('L2', 1)], 1),
		];
		const rowsR = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('R1', 0), makeCell('R2', 1)], 1),
		];

		const layout = makeLayout(
			0,
			[
				makeRegion(0, 0, [50, 100, 200, 400], rowsL),
				makeRegion(1, 0, [350, 100, 500, 400], rowsR),
			],
			[],
			[{ text: 'Some explanatory intervening note', bbox: [220, 150, 330, 250], assigned: false }],
		);

		const merged = mergeTableRegions([layout]);
		expect(merged[0]!.regions).toHaveLength(2);
	});

	it('shares continuity ID for table spanning page 1 and page 2 (spec case 3)', () => {
		const rowsP1 = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('P1-1', 0), makeCell('P1-2', 1)], 1),
		];
		const rowsP2 = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('P2-1', 0), makeCell('P2-2', 1)], 1),
		];

		const layouts = [
			makeLayout(0, [makeRegion(0, 0, [50, 100, 500, 700], rowsP1)]),
			makeLayout(1, [makeRegion(0, 1, [50, 100, 500, 700], rowsP2)]),
		];

		const merged = mergeTableRegions(layouts);
		expect(merged[0]!.regions[0]!.id).toBe(0);
		expect(merged[1]!.regions[0]!.id).toBe(0);
	});

	it('assigns different IDs when table on page 1 and page 3 are separated by text on page 2 (spec case 4)', () => {
		const rowsP1 = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('P1-1', 0), makeCell('P1-2', 1)], 1),
		];
		const rowsP3 = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('P3-1', 0), makeCell('P3-2', 1)], 1),
		];

		const layouts = [
			makeLayout(0, [makeRegion(0, 0, [50, 100, 500, 700], rowsP1)]),
			makeLayout(1, [], [], [{ text: 'Large body text paragraph filling page 2', bbox: [50, 100, 500, 700], assigned: false }]),
			makeLayout(2, [makeRegion(0, 2, [50, 100, 500, 700], rowsP3)]),
		];

		const merged = mergeTableRegions(layouts);
		expect(merged[0]!.regions[0]!.id).toBe(0);
		expect(merged[2]!.regions[0]!.id).toBe(1);
	});

	it('merges continuation column even if continuation omits headers (spec edge case 2)', () => {
		const rowsL = [
			makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
			makeRow([makeCell('L1', 0), makeCell('L2', 1)], 1),
		];
		// Right column has no headers, just 2 data rows with 2 columns
		const rowsR = [
			makeRow([makeCell('R1', 0), makeCell('R2', 1)], 0, false),
			makeRow([makeCell('R3', 0), makeCell('R4', 1)], 1, false),
		];

		const layout = makeLayout(0, [
			makeRegion(0, 0, [50, 100, 250, 500], rowsL),
			makeRegion(1, 0, [300, 100, 500, 500], rowsR),
		]);

		const merged = mergeTableRegions([layout]);
		expect(merged[0]!.regions).toHaveLength(1);
		expect(merged[0]!.regions[0]!.rows).toHaveLength(4);
	});

	it('handles uneven row counts cleanly (spec edge case 3)', () => {
		const rowsL = [
			makeRow([makeCell('Col A', 0, true)], 0, true),
			makeRow([makeCell('L1', 0)], 1),
			makeRow([makeCell('L2', 0)], 2),
			makeRow([makeCell('L3', 0)], 3),
		];
		const rowsR = [
			makeRow([makeCell('Col A', 0, true)], 0, true),
			makeRow([makeCell('R1', 0)], 1),
		];

		const layout = makeLayout(0, [
			makeRegion(0, 0, [50, 100, 250, 500], rowsL),
			makeRegion(1, 0, [300, 100, 500, 500], rowsR),
		]);

		const merged = mergeTableRegions([layout]);
		expect(merged[0]!.regions[0]!.rows).toHaveLength(5);
	});

	describe('three-tier side-by-side table merge decisions', () => {
		it('Tier 1: confirms stack right under left when consecutive sequence is detected across blocks', () => {
			const rowsL = [
				makeRow([makeCell('SNo', 0, true), makeCell('Item', 1, true)], 0, true),
				makeRow([makeCell('1', 0), makeCell('Apple', 1)], 1),
				makeRow([makeCell('2', 0), makeCell('Banana', 1)], 2),
				makeRow([makeCell('3', 0), makeCell('Cherry', 1)], 3),
			];
			const rowsR = [
				makeRow([makeCell('SNo', 0, true), makeCell('Item', 1, true)], 0, true),
				makeRow([makeCell('4', 0), makeCell('Date', 1)], 1),
				makeRow([makeCell('5', 0), makeCell('Elderberry', 1)], 2),
				makeRow([makeCell('6', 0), makeCell('Fig', 1)], 3),
			];

			const layout = makeLayout(0, [
				makeRegion(0, 0, [50, 100, 250, 500], rowsL),
				makeRegion(1, 0, [300, 100, 500, 500], rowsR),
			]);

			const { layouts, report } = mergeTableRegionsWithReport([layout]);
			expect(layouts[0]!.regions).toHaveLength(1);
			expect(report.totalMerged).toBe(1);
			expect(report.tierCounts.sequenceConfirmed).toBe(1);
			expect(report.confirmedDirection).toBe('stack-right-under-left');
			expect(layouts[0]!.regions[0]!.rows).toHaveLength(7); // 1 header + 6 data
		});

		it('Tier 1: flags parallel running columns across document when sequence jumps far ahead', () => {
			const rowsL = [
				makeRow([makeCell('ID', 0, true), makeCell('Item', 1, true)], 0, true),
				makeRow([makeCell('1', 0), makeCell('Apple', 1)], 1),
				makeRow([makeCell('2', 0), makeCell('Banana', 1)], 2),
				makeRow([makeCell('3', 0), makeCell('Cherry', 1)], 3),
			];
			const rowsR = [
				makeRow([makeCell('ID', 0, true), makeCell('Item', 1, true)], 0, true),
				makeRow([makeCell('500', 0), makeCell('Xylophone', 1)], 1),
				makeRow([makeCell('501', 0), makeCell('Yak', 1)], 2),
				makeRow([makeCell('502', 0), makeCell('Zebra', 1)], 3),
			];

			const layout = makeLayout(0, [
				makeRegion(0, 0, [50, 100, 250, 500], rowsL),
				makeRegion(1, 0, [300, 100, 500, 500], rowsR),
			]);

			const { layouts, report } = mergeTableRegionsWithReport([layout]);
			expect(layouts[0]!.regions).toHaveLength(2); // Not merged per page!
			expect(report.tierCounts.sequenceConfirmed).toBe(1);
			expect(report.decisions[0]!.direction).toBe('parallel-end-to-end');
			expect(report.decisions[0]!.merged).toBe(false);
		});

		it('Tier 2: merges via fallback heuristic when no sequence signal exists and side-by-side pattern recurs', () => {
			const rowsL = [
				makeRow([makeCell('Category', 0, true), makeCell('Amount', 1, true)], 0, true),
				makeRow([makeCell('Commercial', 0), makeCell('10,000', 1)], 1),
			];
			const rowsR = [
				makeRow([makeCell('Category', 0, true), makeCell('Amount', 1, true)], 0, true),
				makeRow([makeCell('Residential', 0), makeCell('20,000', 1)], 1),
			];

			const layout = makeLayout(0, [
				makeRegion(0, 0, [50, 100, 250, 500], rowsL),
				makeRegion(1, 0, [300, 100, 500, 500], rowsR),
			]);

			const { layouts, report } = mergeTableRegionsWithReport([layout]);
			expect(layouts[0]!.regions).toHaveLength(1);
			expect(report.totalMerged).toBe(1);
			expect(report.tierCounts.heuristic).toBe(1);
			expect(report.confirmedDirection).toBe('stack-right-under-left');
		});

		it('Tier 3: does NOT merge when blocks have distinguishing captions', () => {
			const rowsL = [
				makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
				makeRow([makeCell('L1', 0), makeCell('L2', 1)], 1),
			];
			const rowsR = [
				makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
				makeRow([makeCell('R1', 0), makeCell('R2', 1)], 1),
			];

			const layout = makeLayout(
				0,
				[
					makeRegion(0, 0, [50, 100, 250, 500], rowsL),
					makeRegion(1, 0, [300, 100, 500, 500], rowsR),
				],
				[
					{ text: 'North Zone Defaulters', bbox: [50, 70, 250, 95] as BBox, isBold: true },
					{ text: 'South Zone Defaulters', bbox: [300, 70, 500, 95] as BBox, isBold: true },
				],
			);

			let warned = false;
			const { layouts, report } = mergeTableRegionsWithReport([layout], () => {
				warned = true;
			});
			expect(layouts[0]!.regions).toHaveLength(2); // Kept separate
			expect(report.totalMerged).toBe(0);
			expect(report.tierCounts.flaggedAmbiguous).toBe(1);
			expect(warned).toBe(true);
		});
	});
});
