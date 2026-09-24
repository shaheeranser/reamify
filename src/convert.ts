/**
 * Conversion pipeline.
 *
 * Routes between the new layout engine (default) and the legacy markdown
 * path. All routing is based on the `extraction` option, not on document
 * content — the same code path runs for every PDF.
 */

import {
	writePagesToWorkbook,
	type WorkbookOptions,
	type PageRows,
} from './write/index.js';
import type { ExtractionMode, OnWarning, WorksheetPolicy, ConversionDiagnostics } from './types.js';

export interface InspectorOptions {
	pageNumbers?: number[];
}

/** Callback to receive conversion diagnostics after completion. */
export type OnDiagnostics = (diagnostics: ConversionDiagnostics) => void;

export type ConvertOptions = InspectorOptions &
	WorkbookOptions & {
		/** Extraction mode: 'auto' (default), 'positions', or 'markdown-legacy'. */
		extraction?: ExtractionMode;
		/** Pages per extraction batch for bounded memory. Default: 25. */
		batchSize?: number;
		/** Warning callback for ambiguous cells, OCR needs, etc. */
		onWarning?: OnWarning;
		/** Worksheet layout policy. Default: 'auto'. */
		worksheetPolicy?: WorksheetPolicy;
		/** Callback to receive conversion diagnostics. */
		onDiagnostics?: OnDiagnostics;
	};

/** The public return type — same as before for backward compatibility. */
export type WorkbookResult = Buffer | ArrayBuffer | void;

/**
 * Convert a PDF buffer to an XLSX workbook.
 *
 * By default uses the three-tier layout engine for geometry-aware extraction.
 * Pass `extraction: 'markdown-legacy'` to use the original markdown path.
 */
export async function convertPdf(
	pdf: Buffer,
	options: ConvertOptions = {},
): Promise<WorkbookResult> {
	const mode = options.extraction ?? 'auto';

	if (mode === 'markdown-legacy') {
		// Legacy path: use the original markdown-based engine
		const { extractPdfPages } = await import('./legacy/engine.js');
		const result = await writePagesToWorkbook(extractPdfPages(pdf, options), {
			...options,
			worksheetPolicy: undefined, // legacy path doesn't support policies
		});
		options.onDiagnostics?.(result.diagnostics);
		return result.output;
	}

	// New path: three-tier layout engine
	const { extractPdfPagesLayout } = await import('./extract/index.js');

	const layoutPages = extractPdfPagesLayout(pdf, {
		pageNumbers: options.pageNumbers,
		batchSize: options.batchSize,
		extraction: mode,
		onWarning: options.onWarning,
	});

	const result = await writePagesToWorkbook(layoutPages, {
		sheetName: options.sheetName,
		includePageColumn: options.includePageColumn,
		includeEntryColumn: options.includeEntryColumn,
		filename: options.filename,
		stream: options.stream,
		worksheetPolicy: options.worksheetPolicy ?? 'auto',
		onWarning: options.onWarning,
		keepRepeatedHeaders: (options as Record<string, unknown>).keepRepeatedHeaders as boolean | undefined,
		mergeContinuations: options.mergeContinuations,
	});

	options.onDiagnostics?.(result.diagnostics);
	return result.output;
}

/**
 * Convert pre-extracted pages to an XLSX workbook.
 *
 * This is the browser-compatible entry point. It accepts page rows from
 * any source and wraps them as single-region PageLayouts for the writer.
 * No PDF extraction happens here.
 */
export async function convertPages(
	pages: AsyncIterable<string[][]> | Iterable<string[][]>,
	options: WorkbookOptions & { onDiagnostics?: OnDiagnostics } = {},
): Promise<WorkbookResult> {
	async function* numberedPages(): AsyncGenerator<PageRows> {
		let page = 0;
		for await (const rows of pages) {
			yield { page, rows };
			page += 1;
		}
	}

	const result = await writePagesToWorkbook(numberedPages(), options);
	options.onDiagnostics?.(result.diagnostics);
	return result.output;
}
