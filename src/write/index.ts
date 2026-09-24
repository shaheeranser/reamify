import type { Stream } from 'node:stream';
import type { PageLayout, WorksheetPolicy, OnWarning, ConversionDiagnostics } from '../types.js';
import { resolvePolicy } from './policy.js';
import { writePerRegion } from './per-region.js';
import { writeStacked } from './stacked.js';
import { writeLegacyPages, pageRowsToLayout, type PageRows } from './legacy.js';
import { mergeTableRegions } from '../extract/merge.js';
import { reconstructMultiLineHeaders, filterRepeatedHeaders, postprocessLayouts } from './postprocess.js';

export type { PageRows };

export interface WorkbookOptions {
	sheetName?: string;
	includePageColumn?: boolean;
	includeEntryColumn?: boolean;
	filename?: string;
	stream?: Stream;
	worksheetPolicy?: WorksheetPolicy;
	onWarning?: OnWarning;
	keepRepeatedHeaders?: boolean;
	mergeContinuations?: boolean;
}

export type WorkbookResult = {
	output: Buffer | ArrayBuffer | void;
	diagnostics: ConversionDiagnostics;
};

function createDiagnostics(): ConversionDiagnostics {
	return {
		totalPages: 0,
		totalRegions: 0,
		totalRows: 0,
		totalWarnings: 0,
		ambiguousCells: 0,
		unassignedTextItems: 0,
		ocrPages: 0,
		tierCounts: {
			'vector-grid-cells': 0,
			'region-tables': 0,
			'clustered': 0,
		},
	};
}

function isPageLayout(page: PageRows | PageLayout): page is PageLayout {
	return 'regions' in page;
}

export async function writePagesToWorkbook(
	pages: AsyncIterable<PageRows | PageLayout> | Iterable<PageRows | PageLayout>,
	options: WorkbookOptions = {},
): Promise<WorkbookResult> {
	const diag = createDiagnostics();
	const policy = options.worksheetPolicy ?? 'auto';
	const includePageColumn = options.includePageColumn ?? false;
	const keepRepeatedHeaders = options.keepRepeatedHeaders ?? false;
	const baseName = options.sheetName ?? 'Extracted tables';

	const allPages: Array<PageRows | PageLayout> = [];
	for await (const page of pages) {
		allPages.push(page);
	}

	if (allPages.length === 0) {
		return { output: undefined as unknown as void, diagnostics: diag };
	}

	const hasLayouts = allPages.some(isPageLayout);

	if (!hasLayouts) {
		return writeLegacyPages(
			allPages as PageRows[],
			options,
			diag,
		);
	}

	const rawLayouts = allPages.map((p) =>
		isPageLayout(p) ? p : pageRowsToLayout(p),
	);

	// 1. Header reconstruction: join multi-line header fragments into canonical headers
	const canonicalLabels = reconstructMultiLineHeaders(rawLayouts);

	// 2. Table merge: three-tier decision and execution for side-by-side blocks
	const layouts = (options.mergeContinuations ?? true)
		? mergeTableRegions(rawLayouts, options.onWarning)
		: rawLayouts;

	// 3. Header-row filter (dedupe): drop repeated header rows post-merge
	if (!keepRepeatedHeaders && canonicalLabels) {
		filterRepeatedHeaders(layouts, canonicalLabels);
	}

	const effectivePolicy = resolvePolicy(policy, layouts, options.onWarning);

	if (effectivePolicy === 'per-region') {
		return writePerRegion(layouts, options, diag, baseName, includePageColumn, keepRepeatedHeaders);
	} else {
		return writeStacked(layouts, options, diag, baseName, includePageColumn, keepRepeatedHeaders);
	}
}
