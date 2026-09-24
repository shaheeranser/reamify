import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { writePagesToWorkbook } from '../../src/write/index.js';
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

async function readWorkbook(buffer: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(buffer as Buffer);
	return wb;
}

describe('writer per-region policy', () => {
	it('creates one sheet per region slot (matrix case 2)', async () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('L-H1', 0, true), makeCell('L-H2', 1, true)], 0, true),
					makeRow([makeCell('L-D1', 0), makeCell('L-D2', 1)], 1),
				]),
				makeRegion(1, 0, [
					makeRow([makeCell('R-H1', 0, true), makeCell('R-H2', 1, true)], 0, true),
					makeRow([makeCell('R-D1', 0), makeCell('R-D2', 1)], 1),
				]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, {
			worksheetPolicy: 'per-region',
		});

		const wb = await readWorkbook(result.output as Buffer);
		expect(wb.worksheets).toHaveLength(2);

		const ws1 = wb.worksheets[0]!;
		expect(ws1.getRow(1).getCell(1).value).toBe('L-H1');

		const ws2 = wb.worksheets[1]!;
		expect(ws2.getRow(1).getCell(1).value).toBe('R-H1');
	});

	it('deduplicates repeated headers across pages (matrix case 4)', async () => {
		const header = makeRow([makeCell('Col A', 0, true), makeCell('Col B', 1, true)], 0, true);

		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					{ ...header },
					makeRow([makeCell('P1-D1', 0), makeCell('P1-D2', 1)], 1),
				]),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [
					{ ...header },
					makeRow([makeCell('P2-D1', 0), makeCell('P2-D2', 1)], 1),
				]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, {
			worksheetPolicy: 'per-region',
			keepRepeatedHeaders: false,
		});

		const wb = await readWorkbook(result.output as Buffer);
		const ws = wb.worksheets[0]!;

		expect(ws.getRow(1).getCell(1).value).toBe('Col A');
		expect(ws.getRow(2).getCell(1).value).toBe('P1-D1');
		expect(ws.getRow(3).getCell(1).value).toBe('P2-D1');
	});
});

describe('writer structural checks', () => {
	it('produces stable column counts within a region', async () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('H1', 0, true), makeCell('H2', 1, true), makeCell('H3', 2, true)], 0, true),
					makeRow([makeCell('D1', 0), makeCell('D2', 1), makeCell('D3', 2)], 1),
					makeRow([makeCell('D4', 0), makeCell('D5', 1), makeCell('D6', 2)], 2),
				]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, { worksheetPolicy: 'per-region' });
		const wb = await readWorkbook(result.output as Buffer);
		const ws = wb.worksheets[0]!;

		for (let r = 1; r <= 3; r++) {
			const row = ws.getRow(r);
			expect(row.getCell(3).value).toBeTruthy();
		}
	});

	it('handles title rows from PageLayout', async () => {
		const layouts: PageLayout[] = [
			{
				page: 0,
				regions: [
					makeRegion(0, 0, [
						makeRow([makeCell('Data', 0)], 0),
					]),
				],
				titles: [{ text: 'My Table Heading', bbox: [0, 0, 100, 20], isBold: true }],
				outsideText: [],
				needsOcr: false,
			},
		];

		const result = await writePagesToWorkbook(layouts, { worksheetPolicy: 'per-region' });
		const wb = await readWorkbook(result.output as Buffer);
		const ws = wb.worksheets[0]!;

		expect(ws.getRow(1).getCell(1).value).toBe('My Table Heading');
		expect(ws.getRow(2).getCell(1).value).toBe('Data');
	});

	it('tracks diagnostics correctly', async () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('A', 0)], 0),
					makeRow([makeCell('B', 0)], 1),
				]),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [
					makeRow([makeCell('C', 0)], 0),
				]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, { worksheetPolicy: 'per-region' });
		expect(result.diagnostics.totalPages).toBe(2);
		expect(result.diagnostics.totalRegions).toBe(2);
		expect(result.diagnostics.totalRows).toBe(3);
	});

	it('unifies side-by-side continuation tables into a single sheet (D2 fix)', async () => {
		const header = [
			makeRow([makeCell('Contract No', 0, true), makeCell('IBC Name', 1, true)], 0, true),
		];
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					...header,
					makeRow([makeCell('1001', 0), makeCell('Uthal', 1)], 1),
				]),
				// Side-by-side right table: bbox x 300..500 vs left 50..250
				{
					...makeRegion(1, 0, [
						...header,
						makeRow([makeCell('1002', 0), makeCell('KIMZ', 1)], 1),
					]),
					bbox: [300, 0, 500, 100] as BBox,
				},
			]),
		];
		// left region bbox
		layouts[0]!.regions[0]!.bbox = [50, 0, 250, 100] as BBox;

		const result = await writePagesToWorkbook(layouts, { worksheetPolicy: 'per-region' });
		const wb = await readWorkbook(result.output as Buffer);

		// Must produce exactly 1 sheet instead of splitting into Region 1 and Region 2
		expect(wb.worksheets).toHaveLength(1);
		const ws = wb.worksheets[0]!;
		expect(ws.name).toBe('Extracted tables');
		expect(ws.getRow(1).getCell(1).value).toBe('Contract No');
		expect(ws.getRow(2).getCell(1).value).toBe('1001');
		expect(ws.getRow(3).getCell(1).value).toBe('1002');
	});

	it('deduplicates multi-line header blocks across pages (D1 fix)', async () => {
		const multiLineHeader = [
			makeRow([makeCell('Contract No', 0, true), makeCell('Outstanding Dues', 1, true)], 0, true),
			makeRow([makeCell('(April-26)', 1, true)], 1, true),
		];

		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					...multiLineHeader.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) })),
					makeRow([makeCell('P1-Row', 0), makeCell('100', 1)], 2),
				]),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [
					...multiLineHeader.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) })),
					makeRow([makeCell('P2-Row', 0), makeCell('200', 1)], 2),
				]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, {
			worksheetPolicy: 'per-region',
			keepRepeatedHeaders: false,
		});
		const wb = await readWorkbook(result.output as Buffer);
		const ws = wb.worksheets[0]!;

		// Header row should appear once at the top with joined column labels
		expect(ws.getRow(1).getCell(1).value).toBe('Contract No');
		expect(ws.getRow(1).getCell(2).value).toBe('Outstanding Dues (April-26)');
		// Followed directly by data rows from both pages (no repeated header block!)
		expect(ws.getRow(2).getCell(1).value).toBe('P1-Row');
		expect(ws.getRow(3).getCell(1).value).toBe('P2-Row');
	});

	it('supports includeEntryColumn for sequential numbering (D4)', async () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Header', 0, true)], 0, true),
					makeRow([makeCell('Item A', 0)], 1),
					makeRow([makeCell('Item B', 0)], 2),
				]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, {
			worksheetPolicy: 'per-region',
			includeEntryColumn: true,
		});
		const wb = await readWorkbook(result.output as Buffer);
		const ws = wb.worksheets[0]!;

		expect(ws.getRow(1).getCell(1).value).toBe('#');
		expect(ws.getRow(1).getCell(2).value).toBe('Header');
		expect(ws.getRow(2).getCell(1).value).toBe(1);
		expect(ws.getRow(2).getCell(2).value).toBe('Item A');
		expect(ws.getRow(3).getCell(1).value).toBe(2);
		expect(ws.getRow(3).getCell(2).value).toBe('Item B');
	});
});
