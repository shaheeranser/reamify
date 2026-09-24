import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { writePagesToWorkbook, type PageRows } from '../../src/write/index.js';

async function readWorkbook(buffer: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(buffer as Buffer);
	return wb;
}

describe('writer backward compatibility', () => {
	it('writes legacy PageRows to buffer', async () => {
		const pages: PageRows[] = [
			{ page: 0, rows: [['A', 'B'], ['1', '2']] },
		];

		const result = await writePagesToWorkbook(pages);
		expect(result.output instanceof ArrayBuffer || Buffer.isBuffer(result.output)).toBe(true);
		expect(result.diagnostics.totalPages).toBe(1);
		expect(result.diagnostics.totalRows).toBe(2);
	});

	it('writes legacy PageRows to stream', async () => {
		const stream = new PassThrough();
		const chunks: Buffer[] = [];
		stream.on('data', (chunk: Buffer) => chunks.push(chunk));

		const pages: PageRows[] = [
			{ page: 0, rows: [['X']] },
		];

		const result = await writePagesToWorkbook(pages, { stream });
		expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK');
	});

	it('includes page column when requested', async () => {
		const pages: PageRows[] = [
			{ page: 0, rows: [['A', 'B']] },
		];

		const result = await writePagesToWorkbook(pages, { includePageColumn: true });
		const wb = await readWorkbook(result.output as Buffer);
		const ws = wb.worksheets[0]!;
		const row = ws.getRow(1);
		expect(row.getCell(1).value).toBe(1);
		expect(row.getCell(2).value).toBe('A');
	});
});
