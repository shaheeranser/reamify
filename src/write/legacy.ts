import ExcelJS from 'exceljs';
import type { PageLayout, TableRow, ConversionDiagnostics } from '../types.js';
import type { WorkbookOptions, WorkbookResult } from './index.js';

export interface PageRows {
	page: number;
	rows: string[][];
}

export function pageRowsToLayout(page: PageRows): PageLayout {
	const rows: TableRow[] = page.rows.map((cells, idx) => ({
		index: idx,
		isHeader: idx === 0,
		cells: cells.map((text, colIdx) => ({
			text,
			bbox: [0, 0, 0, 0] as [number, number, number, number],
			column: colIdx,
			rowspan: 1,
			colspan: 1,
			isHeader: idx === 0,
			confidence: 1.0,
			ambiguous: false,
		})),
	}));

	return {
		page: page.page,
		regions: rows.length > 0
			? [
				{
					id: 0,
					page: page.page,
					bbox: [0, 0, 0, 0],
					source: 'clustered' as const,
					rows,
				},
			]
			: [],
		titles: [],
		outsideText: [],
		needsOcr: false,
	};
}

export async function writeLegacyPages(
	pages: PageRows[],
	options: WorkbookOptions,
	diag: ConversionDiagnostics,
): Promise<WorkbookResult> {
	const includePageColumn = options.includePageColumn ?? false;
	const sheetName = options.sheetName ?? 'Extracted tables';

	if (options.filename || options.stream) {
		const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
			filename: options.filename,
			stream: options.stream,
			useStyles: false,
			useSharedStrings: false,
		});
		const worksheet = workbook.addWorksheet(sheetName);

		for (const page of pages) {
			diag.totalPages++;
			for (const row of page.rows) {
				worksheet.addRow(includePageColumn ? [page.page + 1, ...row] : row).commit();
				diag.totalRows++;
			}
		}

		worksheet.commit();
		await workbook.commit();
		return { output: undefined as unknown as void, diagnostics: diag };
	}

	const workbook = new ExcelJS.Workbook();
	const worksheet = workbook.addWorksheet(sheetName);

	for (const page of pages) {
		diag.totalPages++;
		for (const row of page.rows) {
			worksheet.addRow(includePageColumn ? [page.page + 1, ...row] : row);
			diag.totalRows++;
		}
	}

	const output = await workbook.xlsx.writeBuffer();
	return { output, diagnostics: diag };
}
