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

describe('writer auto policy', () => {
	it('uses per-region when all pages have the same region count', async () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [makeRow([makeCell('A', 0)], 0)]),
				makeRegion(1, 0, [makeRow([makeCell('B', 0)], 0)]),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [makeRow([makeCell('C', 0)], 0)]),
				makeRegion(1, 1, [makeRow([makeCell('D', 0)], 0)]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, {
			worksheetPolicy: 'auto',
		});

		const wb = await readWorkbook(result.output as Buffer);
		expect(wb.worksheets).toHaveLength(2);
	});

	it('falls back to stacked when region count varies (matrix case 8)', async () => {
		const warnings: string[] = [];

		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [makeRow([makeCell('A', 0)], 0)]),
				makeRegion(1, 0, [makeRow([makeCell('B', 0)], 0)]),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [makeRow([makeCell('C', 0)], 0)]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, {
			worksheetPolicy: 'auto',
			onWarning: (w) => warnings.push(w.message),
		});

		const wb = await readWorkbook(result.output as Buffer);
		expect(wb.worksheets).toHaveLength(1);
		expect(warnings.some((w) => w.includes('varies'))).toBe(true);
	});
});
