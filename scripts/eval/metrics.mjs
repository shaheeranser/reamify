/**
 * Accuracy and structural metrics for the comparison harness.
 *
 * Two accuracy signals are produced:
 *  - Coverage proxy: multiset token recall/precision/F1 of the workbook text
 *    against the PDF's own embedded text layer. This is a *proxy*: a tool that
 *    dumps every text line scores high recall even with broken table structure,
 *    so it is reported alongside structural stats, never alone.
 *  - Ground-truth: exact cell/grid comparison against hand-defined expected
 *    grids for the generated ground-truth PDFs.
 */

import ExcelJS from 'exceljs';
import { sandboxRequire } from './sandbox.mjs';

/** Split arbitrary text into normalized lowercased alphanumeric tokens. */
export function tokenize(text) {
	if (text === null || text === undefined) return [];
	return String(text)
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((token) => token.length > 0);
}

/** Normalize a cell's text for exact comparison. */
export function normalizeCell(text) {
	if (text === null || text === undefined) return '';
	return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function cellToString(value) {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') {
		if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
		if ('result' in value) return cellToString(value.result);
		if ('text' in value) return cellToString(value.text);
		if ('hyperlink' in value && 'text' in value) return cellToString(value.text);
	}
	return String(value);
}

function sheetToGrid(worksheet) {
	const grid = [];
	worksheet.eachRow({ includeEmpty: true }, (row) => {
		const cells = [];
		row.eachCell({ includeEmpty: true }, (cell) => {
			cells.push(cellToString(cell.value));
		});
		grid.push(cells);
	});
	return grid;
}

/**
 * Read a workbook into per-sheet grids plus structural statistics and the flat
 * list of tokens contained in all cell values.
 */
export async function readWorkbook(filePath) {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(await import('node:fs').then((fs) => fs.readFileSync(filePath)));

	const sheets = [];
	const allTokens = [];
	let nonEmptyCells = 0;
	let nonEmptyRows = 0;
	let maxColumns = 0;

	for (const worksheet of workbook.worksheets) {
		const grid = sheetToGrid(worksheet);
		let sheetNonEmpty = 0;

		for (const row of grid) {
			let rowHasContent = false;
			for (const cell of row) {
				for (const token of tokenize(cell)) allTokens.push(token);
				if (normalizeCell(cell).length > 0) {
					nonEmptyCells++;
					sheetNonEmpty++;
					rowHasContent = true;
				}
			}
			if (rowHasContent) nonEmptyRows++;
			if (row.length > maxColumns) maxColumns = row.length;
		}

		sheets.push({ name: worksheet.name, grid, nonEmptyCells: sheetNonEmpty });
	}

	return {
		sheets,
		allTokens,
		stats: {
			sheets: sheets.length,
			rows: sheets.reduce((sum, sheet) => sum + sheet.grid.length, 0),
			maxColumns,
			nonEmptyCells,
			nonEmptyRows,
		},
	};
}

function multiset(tokens) {
	const map = new Map();
	for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1);
	return map;
}

function safeRatio(numerator, denominator) {
	return denominator === 0 ? 0 : numerator / denominator;
}

/** Multiset token recall/precision/F1 of `outputTokens` against `referenceTokens`. */
export function coverage(referenceTokens, outputTokens) {
	const reference = multiset(referenceTokens);
	const output = multiset(outputTokens);

	let matched = 0;
	for (const [token, count] of output) {
		const refCount = reference.get(token) ?? 0;
		if (refCount > 0) matched += Math.min(count, refCount);
	}

	const recall = safeRatio(matched, referenceTokens.length);
	const precision = safeRatio(matched, outputTokens.length);
	const f1 = safeRatio(2 * precision * recall, precision + recall);

	return {
		matched,
		referenceTokens: referenceTokens.length,
		outputTokens: outputTokens.length,
		recall,
		precision,
		f1,
	};
}

/**
 * Reconstruct a page's text from pdf.js items using their positions.
 *
 * pdf.js splits runs mid-word at kerning boundaries (e.g. "Dumm" + "y") but
 * may also omit the spaces between separate runs, so neither plain
 * concatenation nor space-joining is correct. A run is joined to the previous
 * one when it starts where the previous ended, separated by a space when there
 * is a horizontal gap, and put on a new line when its baseline moves.
 */
function reconstructPageText(items) {
	let text = '';
	let previousEnd = null;
	let previousY = null;
	let previousHeight = 0;

	for (const item of items) {
		if (typeof item.str !== 'string') continue;
		const x = item.transform[4];
		const y = item.transform[5];
		const height = item.height || 1;

		if (previousEnd !== null) {
			const referenceHeight = Math.max(height, previousHeight);
			if (Math.abs(y - previousY) > 0.5 * referenceHeight) text += '\n';
			else if (x - previousEnd > 0.2 * referenceHeight) text += ' ';
		}

		text += item.str;
		previousEnd = x + (item.width || 0);
		previousY = y;
		previousHeight = height;
	}

	return text;
}

/** Extract the PDF's embedded text tokens using pdf.js from the sandbox. */
export async function pdfTextTokens(buffer) {
	const pdfjs = sandboxRequire('pdfjs-dist');
	const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
	const tokens = [];
	for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
		const page = await doc.getPage(pageNumber);
		const content = await page.getTextContent();
		for (const token of tokenize(reconstructPageText(content.items))) tokens.push(token);
		page.cleanup();
	}
	return { tokens, numPages: doc.numPages };
}

function trimGrid(grid) {
	const rows = grid.map((row) => {
		let last = row.length - 1;
		while (last >= 0 && normalizeCell(row[last]).length === 0) last--;
		return row.slice(0, last + 1);
	});
	let first = 0;
	let last = rows.length - 1;
	while (first <= last && rows[first].every((cell) => normalizeCell(cell).length === 0)) first++;
	while (last >= first && rows[last].every((cell) => normalizeCell(cell).length === 0)) last--;
	return rows.slice(first, last + 1);
}

function flattenGrid(grid) {
	const tokens = [];
	for (const row of grid) {
		for (const cell of row) {
			for (const token of tokenize(cell)) tokens.push(token);
		}
	}
	return tokens;
}

/**
 * Compare the workbook's main sheet against an expected grid.
 *
 * Returns token-level precision/recall/F1 (content) plus whether the
 * normalized grid matches exactly (structure).
 */
export async function compareToGroundTruth(workbookFile, expectedGrid) {
	const workbook = await readWorkbook(workbookFile);
	const mainSheet = workbook.sheets.find((sheet) => sheet.nonEmptyCells > 0) ?? workbook.sheets[0];

	const expectedTokens = flattenGrid(expectedGrid);
	const actualGrid = mainSheet ? trimGrid(mainSheet.grid) : [];
	const actualTokens = flattenGrid(actualGrid);

	const content = coverage(expectedTokens, actualTokens);

	const expectedTrimmed = trimGrid(expectedGrid);
	const exactMatch =
		expectedTrimmed.length === actualGrid.length &&
		expectedTrimmed.every((row, r) =>
			row.length === (actualGrid[r]?.length ?? -1) &&
			row.every((cell, c) => normalizeCell(cell) === normalizeCell(actualGrid[r][c])),
		);

	return {
		sheetName: mainSheet?.name ?? null,
		expectedRows: expectedTrimmed.length,
		actualRows: actualGrid.length,
		content,
		exactMatch,
	};
}
