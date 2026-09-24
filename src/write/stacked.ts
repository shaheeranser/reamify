import ExcelJS from 'exceljs';
import type { PageLayout, ConversionDiagnostics } from '../types.js';
import type { WorkbookOptions, WorkbookResult } from './index.js';

export async function writeStacked(
	layouts: PageLayout[],
	options: WorkbookOptions,
	diag: ConversionDiagnostics,
	baseName: string,
	includePageColumn: boolean,
	_keepRepeatedHeaders: boolean,
): Promise<WorkbookResult> {
	const isStreaming = !!(options.filename || options.stream);
	const workbook = isStreaming
		? new ExcelJS.stream.xlsx.WorkbookWriter({
				filename: options.filename,
				stream: options.stream,
				useStyles: false,
				useSharedStrings: false,
		  })
		: new ExcelJS.Workbook();

	const ws = workbook.addWorksheet(baseName);
	let firstBlock = true;
	let entryCount = 0;
	const includeEntry = !!options.includeEntryColumn;

	const addRow = (values: unknown[]) => {
		const row = ws.addRow(values);
		if (isStreaming) row.commit();
	};

	for (const layout of layouts) {
		diag.totalPages++;
		if (layout.needsOcr) diag.ocrPages++;

		for (const title of layout.titles) {
			addRow(includePageColumn ? [layout.page + 1, title.text] : [title.text]);
		}

		for (const region of layout.regions) {
			diag.totalRegions++;
			diag.tierCounts[region.source]++;

			if (!firstBlock) {
				addRow([]);
			}
			firstBlock = false;

			for (const row of region.rows) {
				const maxCol = row.cells.reduce((max, c) => Math.max(max, c.column), -1);
				const cellValues: string[] = maxCol >= 0 ? Array(maxCol + 1).fill('') : [];
				for (const cell of row.cells) cellValues[cell.column] = cell.text;
				const rowValues: unknown[] = [];
				if (includePageColumn) rowValues.push(layout.page + 1);
				if (includeEntry) rowValues.push(row.isHeader ? '#' : ++entryCount);
				rowValues.push(...cellValues);

				addRow(rowValues);
				diag.totalRows++;

				for (const cell of row.cells) {
					if (cell.ambiguous) diag.ambiguousCells++;
				}
			}
		}

		for (const ot of layout.outsideText) {
			if (!ot.assigned) diag.unassignedTextItems++;
		}
	}

	if (isStreaming) {
		ws.commit();
		await (workbook as ExcelJS.stream.xlsx.WorkbookWriter).commit();
		return { output: undefined as unknown as void, diagnostics: diag };
	} else {
		const output = await (workbook as ExcelJS.Workbook).xlsx.writeBuffer();
		return { output, diagnostics: diag };
	}
}
