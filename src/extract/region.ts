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
	const medianGap = gapSizes[Math.floor(gapSizes.length / 2)]!;
	const relativeMin = medianGap * 1.5;

	const threshold = Math.max(absoluteMin, relativeMin);
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
