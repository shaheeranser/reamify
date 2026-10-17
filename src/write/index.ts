import type { Stream } from 'node:stream';
import type { PageLayout, WorksheetPolicy, OnWarning, ConversionDiagnostics } from '../types.js';
import { resolvePolicyCounts } from './policy.js';
import { writePerRegion } from './per-region.js';
import { writeStacked } from './stacked.js';
import { writeLegacyPages, pageRowsToLayout, type PageRows } from './legacy.js';
import { PageStore } from './page-store.js';
import {
	accumulateSideBySideStats,
	sideBySidePatternFromStats,
	createMergeReport,
	mergePageRegions,
	createRegionIdAssigner,
	setLastMergeReport,
	type SideBySideStats,
} from '../extract/merge.js';
import { reconstructRegionHeaders, createHeaderFilterState, filterRegionHeaders } from './postprocess.js';

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
	/**
	 * Serialized bytes of the page stream kept in memory before spilling to a
	 * temp file. Defaults to 32 MiB. Set to 0 to always spill.
	 */
	spillThresholdBytes?: number;
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

async function* toAsyncIterable<T>(
	source: AsyncIterable<T> | Iterable<T>,
): AsyncGenerator<T> {
	if (Symbol.asyncIterator in source) {
		for await (const value of source as AsyncIterable<T>) yield value;
	} else {
		for (const value of source as Iterable<T>) yield value;
	}
}

/**
 * Bounded-memory layout pipeline.
 *
 * A single upstream pass reconstructs headers, summarizes the document-level
 * side-by-side pattern, and persists pages to a {@link PageStore}. A second
 * pass replays the stored pages to derive the exact worksheet policy and slot
 * count (the only decisions that need the whole document). A final pass
 * streams one page at a time into the workbook, so peak memory is one page
 * plus the store's in-memory budget.
 */
async function writeLayoutPipeline(
	pages: AsyncIterable<PageLayout>,
	options: WorkbookOptions,
	diag: ConversionDiagnostics,
): Promise<WorkbookResult> {
	const policy = options.worksheetPolicy ?? 'auto';
	const includePageColumn = options.includePageColumn ?? false;
	const keepRepeatedHeaders = options.keepRepeatedHeaders ?? false;
	const mergeContinuations = options.mergeContinuations ?? true;
	const baseName = options.sheetName ?? 'Extracted tables';

	const store = new PageStore({ thresholdBytes: options.spillThresholdBytes });

	try {
		// Pass A — reconstruct multi-line headers in place, summarize the
		// document-level side-by-side pattern, and persist each page.
		let canonicalLabels: string[] | null = null;
		const patternStats: SideBySideStats = { multiRegionPages: 0, sideBySidePages: 0 };

		for await (const layout of pages) {
			for (const region of layout.regions) {
				const labels = reconstructRegionHeaders(region);
				if (canonicalLabels === null && labels !== null) canonicalLabels = labels;
			}
			accumulateSideBySideStats(layout, patternStats);
			await store.add(layout);
		}

		const patternConsistent = sideBySidePatternFromStats(patternStats);

		// Pass B — replay stored pages to derive post-merge region counts and
		// the maximum region id, which fully determine the worksheet layout.
		const regionCounts: number[] = [];
		let maxRegions = 0;

		if (mergeContinuations) {
			const report = createMergeReport();
			const measureAssigner = createRegionIdAssigner();
			for await (const layout of store.pages()) {
				mergePageRegions(layout, patternConsistent, report, options.onWarning);
				measureAssigner.assign(layout);
				if (layout.regions.length > 0) regionCounts.push(layout.regions.length);
				for (const region of layout.regions) {
					if (region.id + 1 > maxRegions) maxRegions = region.id + 1;
				}
			}
			setLastMergeReport(report);
		} else {
			for await (const layout of store.pages()) {
				if (layout.regions.length > 0) regionCounts.push(layout.regions.length);
				for (const region of layout.regions) {
					if (region.id + 1 > maxRegions) maxRegions = region.id + 1;
				}
			}
		}

		const effectivePolicy = resolvePolicyCounts(policy, regionCounts, options.onWarning);

		// Pass C — replay again, applying the real (silent) merge, id
		// reassignment and header filter, then stream into the workbook.
		const filterState = !keepRepeatedHeaders && canonicalLabels
			? createHeaderFilterState(canonicalLabels)
			: null;

		async function* rendered(): AsyncGenerator<PageLayout> {
			const assigner = mergeContinuations ? createRegionIdAssigner() : null;

			for await (const layout of store.pages()) {
				if (mergeContinuations) {
					mergePageRegions(layout, patternConsistent, null);
				}
				if (assigner) assigner.assign(layout);
				if (filterState) {
					for (const region of layout.regions) {
						filterRegionHeaders(region, filterState);
					}
				}
				yield layout;
			}
		}

		if (effectivePolicy === 'per-region') {
			return await writePerRegion(
				rendered(),
				options,
				diag,
				baseName,
				includePageColumn,
				keepRepeatedHeaders,
				maxRegions,
			);
		}

		return await writeStacked(
			rendered(),
			options,
			diag,
			baseName,
			includePageColumn,
			keepRepeatedHeaders,
		);
	} finally {
		await store.dispose();
	}
}

export async function writePagesToWorkbook(
	pages: AsyncIterable<PageRows | PageLayout> | Iterable<PageRows | PageLayout>,
	options: WorkbookOptions = {},
): Promise<WorkbookResult> {
	const diag = createDiagnostics();
	const iterator = toAsyncIterable(pages);
	const first = await iterator.next();

	if (first.done) {
		return { output: undefined as unknown as void, diagnostics: diag };
	}

	const firstPage = first.value;

	async function* remaining(): AsyncGenerator<PageRows | PageLayout> {
		yield firstPage;
		for await (const page of iterator) yield page;
	}

	if (!isPageLayout(firstPage)) {
		const collected: Array<PageRows | PageLayout> = [];
		for await (const page of remaining()) collected.push(page);

		if (collected.some(isPageLayout)) {
			return writeLayoutPipeline(
				(async function* () {
					for (const page of collected) {
						yield isPageLayout(page) ? page : pageRowsToLayout(page);
					}
				})(),
				options,
				diag,
			);
		}

		return writeLegacyPages(collected as PageRows[], options, diag);
	}

	return writeLayoutPipeline(
		(async function* () {
			for await (const page of remaining()) {
				yield isPageLayout(page) ? page : pageRowsToLayout(page);
			}
		})(),
		options,
		diag,
	);
}
