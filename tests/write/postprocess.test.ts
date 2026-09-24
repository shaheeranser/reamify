import { describe, it, expect } from 'vitest';
import type { PageLayout, TableRegion, TableRow, TableCell, BBox } from '../../src/types.js';
import {
	reconstructMultiLineHeaders,
	filterRepeatedHeaders,
	renumberSerials,
	postprocessLayouts,
} from '../../src/write/postprocess.js';

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

function makeRegion(id: number, page: number, rows: TableRow[]): TableRegion {
	return {
		id,
		page,
		bbox: [0, 0, 100, 100] as BBox,
		source: 'clustered',
		rows,
	};
}

function makeLayout(page: number, regions: TableRegion[]): PageLayout {
	return {
		page,
		regions,
		titles: [],
		outsideText: [],
		needsOcr: false,
	};
}

describe('reconstructMultiLineHeaders', () => {
	it('joins multi-line headers into a single row per region', () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Contract No', 0, true), makeCell('Outstanding Dues', 1, true)], 0, true),
					makeRow([makeCell('(April-26)', 1, true)], 1, true),
					makeRow([makeCell('1001', 0), makeCell('100', 1)], 2),
				]),
			]),
		];

		const labels = reconstructMultiLineHeaders(layouts);

		expect(labels).not.toBeNull();
		expect(labels).toEqual(['Contract No', 'Outstanding Dues (April-26)']);

		// Should have removed the second header row
		const rows = layouts[0]!.regions[0]!.rows;
		expect(rows).toHaveLength(2);
		expect(rows[0]!.isHeader).toBe(true);
		expect(rows[0]!.cells[0]!.text).toBe('Contract No');
		expect(rows[0]!.cells[1]!.text).toBe('Outstanding Dues (April-26)');
		expect(rows[1]!.cells[0]!.text).toBe('1001');
	});

	it('returns null when no header rows exist', () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('1001', 0), makeCell('100', 1)], 0),
				]),
			]),
		];

		expect(reconstructMultiLineHeaders(layouts)).toBeNull();
	});

	it('leaves single-line headers unchanged', () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
					makeRow([makeCell('D1', 0), makeCell('D2', 1)], 1),
				]),
			]),
		];

		const labels = reconstructMultiLineHeaders(layouts);
		expect(labels).toEqual(['Col A', 'Col B']);

		// Row count unchanged
		expect(layouts[0]!.regions[0]!.rows).toHaveLength(2);
	});
});

describe('filterRepeatedHeaders', () => {
	it('removes repeated header and data rows that match the canonical header', () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
					makeRow([makeCell('D1', 0), makeCell('D2', 1)], 1),
				]),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [
					makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
					// This is a data row (isHeader=false) that matches header text
					makeRow([makeCell('Col A', 0), makeCell('Col B', 1)], 1),
					makeRow([makeCell('D3', 0), makeCell('D4', 1)], 2),
				]),
			]),
		];

		filterRepeatedHeaders(layouts, ['Col A', 'Col B']);

		// Page 0: header kept (first occurrence) + data
		const p1Rows = layouts[0]!.regions[0]!.rows;
		expect(p1Rows).toHaveLength(2);
		expect(p1Rows[0]!.isHeader).toBe(true);

		// Page 1: header removed (duplicate) + matching data row removed + D3/D4 kept
		const p2Rows = layouts[1]!.regions[0]!.rows;
		expect(p2Rows).toHaveLength(1); // only D3/D4
		expect(p2Rows[0]!.cells[0]!.text).toBe('D3');
	});

	it('is case-insensitive and whitespace-tolerant', () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Col A', 0, true)], 0, true),
					makeRow([makeCell('  col  a  ', 0)], 1), // should be filtered
					makeRow([makeCell('data', 0)], 2),
				]),
			]),
		];

		filterRepeatedHeaders(layouts, ['Col A']);

		const rows = layouts[0]!.regions[0]!.rows;
		expect(rows).toHaveLength(2);
		expect(rows[1]!.cells[0]!.text).toBe('data');
	});

	it('does not remove legitimate data rows', () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Name', 0, true), makeCell('Amount', 1, true)], 0, true),
					makeRow([makeCell('Alice', 0), makeCell('100', 1)], 1),
					makeRow([makeCell('Bob', 0), makeCell('200', 1)], 2),
				]),
			]),
		];

		filterRepeatedHeaders(layouts, ['Name', 'Amount']);

		const rows = layouts[0]!.regions[0]!.rows;
		expect(rows).toHaveLength(3); // header + 2 data rows
	});

	it('filters out repeated header row carried from a merged side-by-side block', () => {
		const canonical = ['Contract No', 'IBC Name'];
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Contract No', 0, true), makeCell('IBC Name', 1, true)], 0, true),
					makeRow([makeCell('101', 0), makeCell('Uthal', 1)], 1),
					// Carried from merged block 2: repeated header row
					makeRow([makeCell('Contract No', 0, true), makeCell('IBC Name', 1, true)], 2, true),
					makeRow([makeCell('102', 0), makeCell('KIMZ', 1)], 3),
				]),
			]),
		];

		filterRepeatedHeaders(layouts, canonical);

		const rows = layouts[0]!.regions[0]!.rows;
		expect(rows).toHaveLength(3); // 1 header + 2 data rows
		expect(rows[0]!.isHeader).toBe(true);
		expect(rows[0]!.cells[0]!.text).toBe('Contract No');
		expect(rows[1]!.cells[0]!.text).toBe('101');
		expect(rows[2]!.cells[0]!.text).toBe('102');
	});

	it('eliminates header rows from all pages except the first (document-level scope)', () => {
		const canonical = ['Col A', 'Col B'];
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
					makeRow([makeCell('D1', 0), makeCell('D2', 1)], 1),
				]),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [
					makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
					makeRow([makeCell('D3', 0), makeCell('D4', 1)], 1),
				]),
			]),
			makeLayout(2, [
				makeRegion(0, 2, [
					makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true),
					makeRow([makeCell('D5', 0), makeCell('D6', 1)], 1),
				]),
			]),
		];

		filterRepeatedHeaders(layouts, canonical);

		// Page 0: header kept (first occurrence)
		expect(layouts[0]!.regions[0]!.rows).toHaveLength(2);
		expect(layouts[0]!.regions[0]!.rows[0]!.isHeader).toBe(true);

		// Page 1: header REMOVED (was wrongly kept before the fix)
		expect(layouts[1]!.regions[0]!.rows).toHaveLength(1);
		expect(layouts[1]!.regions[0]!.rows[0]!.cells[0]!.text).toBe('D3');

		// Page 2: header REMOVED
		expect(layouts[2]!.regions[0]!.rows).toHaveLength(1);
		expect(layouts[2]!.regions[0]!.rows[0]!.cells[0]!.text).toBe('D5');
	});
});

describe('renumberSerials', () => {
	it('assigns sequential indices to data rows across regions', () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('H', 0, true)], 0, true),
					makeRow([makeCell('A', 0)], 1),
					makeRow([makeCell('B', 0)], 2),
				]),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [
					makeRow([makeCell('H', 0, true)], 0, true),
					makeRow([makeCell('C', 0)], 1),
				]),
			]),
		];

		const count = renumberSerials(layouts);

		expect(count).toBe(3);
		expect(layouts[0]!.regions[0]!.rows[1]!.index).toBe(1);
		expect(layouts[0]!.regions[0]!.rows[2]!.index).toBe(2);
		expect(layouts[1]!.regions[0]!.rows[1]!.index).toBe(3);
	});
});

describe('postprocessLayouts — combined pipeline', () => {
	it('handles multi-line headers + repeated headers + renumbering in one pass', () => {
		const multiLineHeader = [
			makeRow([makeCell('Contract No', 0, true), makeCell('Outstanding Dues', 1, true)], 0, true),
			makeRow([makeCell('(April-26)', 1, true)], 1, true),
		];

		const layouts: PageLayout[] = [
			// Page 0: header + 2 data rows
			makeLayout(0, [
				makeRegion(0, 0, [
					...multiLineHeader.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) })),
					makeRow([makeCell('1001', 0), makeCell('100', 1)], 2),
					makeRow([makeCell('1002', 0), makeCell('200', 1)], 3),
				]),
			]),
			// Page 1: repeated header (should be filtered) + 1 data row
			makeLayout(1, [
				makeRegion(0, 1, [
					makeRow([makeCell('Contract No', 0, true), makeCell('Outstanding Dues', 1, true)], 0, true),
					makeRow([makeCell('(April-26)', 1, true)], 1, true),
					// Data row that happens to match joined header (edge case)
					makeRow([makeCell('Contract No', 0), makeCell('Outstanding Dues (April-26)', 1)], 2),
					makeRow([makeCell('1003', 0), makeCell('300', 1)], 3),
				]),
			]),
		];

		postprocessLayouts(layouts);

		// Page 0: 1 joined header + 2 data rows
		const p0Rows = layouts[0]!.regions[0]!.rows;
		expect(p0Rows).toHaveLength(3);
		expect(p0Rows[0]!.isHeader).toBe(true);
		expect(p0Rows[0]!.cells[1]!.text).toBe('Outstanding Dues (April-26)');
		expect(p0Rows[1]!.cells[0]!.text).toBe('1001');
		expect(p0Rows[2]!.cells[0]!.text).toBe('1002');

		// Page 1: header removed (document-level dedupe) + header-matching data row removed + 1 data row
		const p1Rows = layouts[1]!.regions[0]!.rows;
		expect(p1Rows).toHaveLength(1);
		expect(p1Rows[0]!.cells[0]!.text).toBe('1003');

		// Serial numbering: data rows are 1, 2, 3 across both pages
		expect(p0Rows[1]!.index).toBe(1);
		expect(p0Rows[2]!.index).toBe(2);
		expect(p1Rows[0]!.index).toBe(3);
	});
});
