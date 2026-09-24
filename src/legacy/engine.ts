/**
 * Legacy PDF extraction engine.
 *
 * @deprecated Use the layout engine (`layout-engine.ts`) for new code.
 * This module is retained only for backward compatibility and as a fallback
 * when `extraction: 'markdown-legacy'` is specified.
 *
 * The markdown-based path has known limitations:
 * - Side-by-side table regions are collapsed into single wide rows
 * - Non-pipe-table content (headings, trailing text) is dropped
 * - The full document is materialized before the first yield
 *
 * See eval/root-cause-analysis.md for details.
 */

import { extractPagesMarkdownAsync } from '@firecrawl/pdf-inspector';
import { markdownToRows } from './parser.js';

export { markdownToRows } from './parser.js';

export interface ExtractedPage {
	page: number;
	rows: string[][];
	hasTable: boolean;
	hasColumns: boolean;
}

export interface InspectorOptions {
	pageNumbers?: number[];
}

/**
 * @deprecated Use `extractPdfPagesLayout` from `layout-engine.ts` instead.
 */
export async function* extractPdfPages(
	pdf: Buffer,
	options: InspectorOptions = {},
): AsyncGenerator<ExtractedPage> {
	const result = await extractPagesMarkdownAsync(pdf, options.pageNumbers);
	const tablePages = new Set(result.pagesWithTables);
	const columnPages = new Set(result.pagesWithColumns);

	for (const page of result.pages) {
		yield {
			page: page.page,
			rows: markdownToRows(page.markdown),
			hasTable: tablePages.has(page.page + 1),
			hasColumns: columnPages.has(page.page + 1),
		};
	}
}
