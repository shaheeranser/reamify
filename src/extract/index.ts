import {
	extractTextWithPositions,
	classifyPdf,
	type TextItem,
} from '@firecrawl/pdf-inspector';
import { extractPageLayout } from './tiers.js';
import { mergeTableRegions, mergeTableRegionsWithReport, getLastMergeReport, headerBlockSignature } from './merge.js';
import type { PageLayout, OnWarning, ExtractionMode } from '../types.js';

export { mergeTableRegions, mergeTableRegionsWithReport, getLastMergeReport, headerBlockSignature };

const DEFAULT_BATCH_SIZE = 25;

export interface LayoutEngineOptions {
	pageNumbers?: number[];
	batchSize?: number;
	extraction?: ExtractionMode;
	onWarning?: OnWarning;
}

export async function* extractPdfPagesLayout(
	pdf: Buffer,
	options: LayoutEngineOptions = {},
): AsyncGenerator<PageLayout> {
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const mode = options.extraction ?? 'auto';
	const onWarning = options.onWarning;

	const classification = classifyPdf(pdf);
	const totalPages = classification.pageCount;
	const ocrPages = new Set(classification.pagesNeedingOcr);

	let pageList: number[];
	if (options.pageNumbers && options.pageNumbers.length > 0) {
		pageList = options.pageNumbers;
	} else {
		pageList = Array.from({ length: totalPages }, (_, i) => i);
	}

	for (let batchStart = 0; batchStart < pageList.length; batchStart += batchSize) {
		const batchPages = pageList.slice(batchStart, batchStart + batchSize);

		const oneIndexed = batchPages.map((p) => p + 1);
		const items = extractTextWithPositions(pdf, oneIndexed);

		const itemsByPage = new Map<number, TextItem[]>();
		for (const item of items) {
			const pageItems = itemsByPage.get(item.page) ?? [];
			pageItems.push(item);
			itemsByPage.set(item.page, pageItems);
		}

		for (const pageNum0 of batchPages) {
			const pageNum1 = pageNum0 + 1;
			const pageItems = itemsByPage.get(pageNum1) ?? [];

			const { pageWidth, pageHeight } = inferPageDimensions(pageItems);

			const needsOcr = ocrPages.has(pageNum0);
			if (needsOcr) {
				onWarning?.({
					kind: 'needs-ocr',
					page: pageNum0,
					message: `Page ${pageNum0 + 1} needs OCR for reliable extraction`,
				});
			}

			const layout = extractPageLayout(
				pdf,
				pageItems,
				pageNum0,
				pageWidth,
				pageHeight,
				mode,
				onWarning,
			);

			layout.needsOcr = needsOcr;

			yield layout;
		}
	}
}

function inferPageDimensions(items: TextItem[]): {
	pageWidth: number;
	pageHeight: number;
} {
	if (items.length === 0) {
		return { pageWidth: 612, pageHeight: 792 };
	}

	let maxX = 0;
	let maxY = 0;

	for (const item of items) {
		maxX = Math.max(maxX, item.x + item.width);
		maxY = Math.max(maxY, item.y + item.height);
	}

	const margin = 36;
	return {
		pageWidth: maxX + margin,
		pageHeight: maxY + margin,
	};
}
