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

describe('writer stacked policy', () => {
	it('stacks regions vertically in a single sheet', async () => {
		const layouts: PageLayout[] = [
			makeLayout(0, [
				makeRegion(0, 0, [
					makeRow([makeCell('Region1-Data', 0)], 0),
				]),
				makeRegion(1, 0, [
					makeRow([makeCell('Region2-Data', 0)], 0),
				]),
			]),
		];

		const result = await writePagesToWorkbook(layouts, {
			worksheetPolicy: 'stacked',
		});

		const wb = await readWorkbook(result.output as Buffer);
		expect(wb.worksheets).toHaveLength(1);

		const ws = wb.worksheets[0]!;
		expect(ws.getRow(1).getCell(1).value).toBe('Region1-Data');
		expect(ws.getRow(3).getCell(1).value).toBe('Region2-Data');
	});
});
