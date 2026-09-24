import ExcelJS from 'exceljs';
import type { PageLayout, ConversionDiagnostics } from '../types.js';
import type { WorkbookOptions, WorkbookResult } from './index.js';
import { headerSignature, headerBlockSignature } from './policy.js';
import { writeLegacyPages } from './legacy.js';

export async function writePerRegion(
	layouts: PageLayout[],
	options: WorkbookOptions,
	diag: ConversionDiagnostics,
	baseName: string,
	includePageColumn: boolean,
	keepRepeatedHeaders: boolean,
): Promise<WorkbookResult> {
	const maxRegions = Math.max(...layouts.flatMap((l) => l.regions.map((r) => r.id + 1)), 0);
	if (maxRegions === 0) {
		return writeLegacyPages([], options, diag);
	}

	const isStreaming = !!(options.filename || options.stream);
	const workbook = isStreaming
		? new ExcelJS.stream.xlsx.WorkbookWriter({
				filename: options.filename,
				stream: options.stream,
				useStyles: false,
				useSharedStrings: false,
		  })
		: new ExcelJS.Workbook();

	const worksheets: ExcelJS.Worksheet[] = [];
	for (let r = 0; r < maxRegions; r++) {
		const name = maxRegions === 1 ? baseName : `${baseName} (Region ${r + 1})`;
		worksheets.push(workbook.addWorksheet(name));
	}

	const writtenHeaders = new Map<number, Set<string>>();
	const writtenBlockHeaders = new Map<number, Set<string>>();
	for (let r = 0; r < maxRegions; r++) {
		writtenHeaders.set(r, new Set());
		writtenBlockHeaders.set(r, new Set());
	}

	const addRow = (ws: ExcelJS.Worksheet, values: unknown[]) => {
		const row = ws.addRow(values);
		if (isStreaming) row.commit();
	};

	let entryCount = 0;
	const includeEntry = !!options.includeEntryColumn;

	for (const layout of layouts) {
		diag.totalPages++;
		if (layout.needsOcr) diag.ocrPages++;

		if (layout.titles.length > 0 && worksheets[0]) {
			for (const title of layout.titles) {
				addRow(worksheets[0], includePageColumn ? [layout.page + 1, title.text] : [title.text]);
			}
		}

		for (const region of layout.regions) {
			const ws = worksheets[region.id];
			if (!ws) continue;

			diag.totalRegions++;
			diag.tierCounts[region.source]++;

			const headerSigs = writtenHeaders.get(region.id)!;
			const blockSigs = writtenBlockHeaders.get(region.id)!;
			const blockSig = headerBlockSignature(region.rows);
			const skipBlock = !keepRepeatedHeaders && blockSig.length > 0 && blockSigs.has(blockSig);

			for (const row of region.rows) {
				if (row.isHeader && skipBlock) continue;
				if (row.isHeader) {
					const sig = headerSignature(row);
					if (headerSigs.has(sig) && !keepRepeatedHeaders) continue;
					headerSigs.add(sig);
				}

				const maxCol = row.cells.reduce((max, c) => Math.max(max, c.column), -1);
				const cellValues: string[] = maxCol >= 0 ? Array(maxCol + 1).fill('') : [];
				for (const cell of row.cells) cellValues[cell.column] = cell.text;
				const rowValues: unknown[] = [];
				if (includePageColumn) rowValues.push(layout.page + 1);
				if (includeEntry) rowValues.push(row.isHeader ? '#' : ++entryCount);
				rowValues.push(...cellValues);

				addRow(ws, rowValues);
				diag.totalRows++;

				for (const cell of row.cells) {
					if (cell.ambiguous) diag.ambiguousCells++;
				}
			}
			if (blockSig) blockSigs.add(blockSig);
		}

		for (const ot of layout.outsideText) {
			if (!ot.assigned) diag.unassignedTextItems++;
		}
	}

	if (isStreaming) {
		for (const ws of worksheets) ws.commit();
		await (workbook as ExcelJS.stream.xlsx.WorkbookWriter).commit();
		return { output: undefined as unknown as void, diagnostics: diag };
	} else {
		const output = await (workbook as ExcelJS.Workbook).xlsx.writeBuffer();
		return { output, diagnostics: diag };
	}
}
