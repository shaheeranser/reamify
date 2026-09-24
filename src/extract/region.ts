import type { TextItem } from '@firecrawl/pdf-inspector';
import { toTopLeftY } from './geometry.js';

export interface ItemCluster {
	items: TextItem[];
	xMin: number;
	xMax: number;
	yMin: number;
	yMax: number;
}

const MIN_REGION_GAP_FRACTION = 0.04;

/**
 * A region boundary must be a clear *discontinuity* in the page's x-gap
 * distribution, not merely a gap that is larger than average. The split gap
 * must be at least this many times the largest non-boundary gutter sharing
 * the page with it.
 *
 * This replaces a `1.5 x median(gaps)` threshold. A page's median gap is
 * dominated by ordinary intra-table column gutters, so it moves with how
 * wide the widest token in any single column happens to be; that made the
 * threshold drift down far enough, on some pages, to split a table's last
 * column off as its own region. A ratio between adjacent sorted gaps is
 * scale-free and independent of token widths, column count and table count.
 */
const MIN_BOUNDARY_JUMP_RATIO = 1.5;

export function discoverRegions(
	items: TextItem[],
	pageWidth: number,
	pageHeight: number,
): ItemCluster[] {
	if (items.length === 0) return [];

	const textItems = items.filter((it) => it.itemType === 'Text' && it.text.trim().length > 0);
	if (textItems.length === 0) return [];

	const sorted = [...textItems].sort((a, b) => a.x - b.x);

	if (sorted.length < 2) {
		return [buildCluster(sorted, pageHeight)];
	}

	const allGaps: Array<{ index: number; size: number }> = [];
	for (let i = 1; i < sorted.length; i++) {
		const prevRight = sorted[i - 1]!.x + sorted[i - 1]!.width;
		const currLeft = sorted[i]!.x;
		const gap = currLeft - prevRight;
		if (gap > 0) {
			allGaps.push({ index: i, size: gap });
		}
	}

	if (allGaps.length === 0) {
		return [buildCluster(sorted, pageHeight)];
	}

	const absoluteMin = pageWidth * MIN_REGION_GAP_FRACTION;

	const gapSizes = allGaps.map((g) => g.size).sort((a, b) => a - b);

	// Region boundaries sit at the widest *relative* jump between adjacent
	// sorted gap sizes: intra-table gutters form a cluster, and a boundary is
	// a break to a distinctly larger gap. Only gaps that clear the absolute
	// floor can define the break, so ordinary gutters — however wide a token
	// in their column is — can never promote themselves to a boundary.
	let bestRatio = 1;
	let threshold = Infinity;
	for (let i = 0; i < gapSizes.length - 1; i++) {
		const lower = gapSizes[i]!;
		const upper = gapSizes[i + 1]!;
		if (lower <= 0 || upper <= absoluteMin) continue;
		const ratio = upper / lower;
		if (ratio >= MIN_BOUNDARY_JUMP_RATIO && ratio > bestRatio) {
			bestRatio = ratio;
			threshold = Math.max((lower + upper) / 2, absoluteMin);
		}
	}

	const significantGaps = allGaps.filter((g) => g.size > threshold);

	const splitIndices = [0, ...significantGaps.map((g) => g.index), sorted.length];
	const clusters: ItemCluster[] = [];

	for (let i = 0; i < splitIndices.length - 1; i++) {
		const start = splitIndices[i]!;
		const end = splitIndices[i + 1]!;
		const clusterItems = sorted.slice(start, end);
		if (clusterItems.length === 0) continue;
		clusters.push(buildCluster(clusterItems, pageHeight));
	}

	return clusters;
}

function buildCluster(items: TextItem[], pageHeight: number): ItemCluster {
	let xMin = Infinity,
		xMax = -Infinity,
		yMin = Infinity,
		yMax = -Infinity;

	for (const item of items) {
		const tlY = toTopLeftY(item, pageHeight);
		xMin = Math.min(xMin, item.x);
		xMax = Math.max(xMax, item.x + item.width);
		yMin = Math.min(yMin, tlY - item.height);
		yMax = Math.max(yMax, tlY);
	}

	return { items, xMin, xMax, yMin, yMax };
}
