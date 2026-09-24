import type { TextItem } from '@firecrawl/pdf-inspector';
import type { BBox } from '../types.js';
import { itemBBox, toTopLeftY } from './geometry.js';
import type { ItemCluster } from './region.js';

export interface TitleItem {
	text: string;
	bbox: BBox;
	isBold: boolean;
}

export interface OutsideTextItem {
	text: string;
	bbox: BBox;
	assigned: boolean;
}

export function identifyTitles(
	items: TextItem[],
	regionTopY: number,
	pageHeight: number,
): TitleItem[] {
	const titles: TitleItem[] = [];

	for (const item of items) {
		if (item.itemType !== 'Text') continue;
		const tlY = toTopLeftY(item, pageHeight);
		if (tlY < regionTopY && item.text.trim().length > 0) {
			titles.push({
				text: item.text.trim(),
				bbox: itemBBox(item, pageHeight),
				isBold: item.isBold,
			});
		}
	}

	titles.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
	return titles;
}

export function assignOutsideText(
	items: TextItem[],
	regions: ItemCluster[],
	pageHeight: number,
): OutsideTextItem[] {
	const results: OutsideTextItem[] = [];

	const regionItemSet = new Set<TextItem>();
	for (const region of regions) {
		for (const item of region.items) {
			regionItemSet.add(item);
		}
	}

	for (const item of items) {
		if (item.itemType !== 'Text') continue;
		if (regionItemSet.has(item)) continue;
		if (item.text.trim().length === 0) continue;

		const bbox = itemBBox(item, pageHeight);

		let assigned = false;
		if (regions.length > 0) {
			const itemCenterX = item.x + item.width / 2;
			for (const region of regions) {
				if (itemCenterX >= region.xMin && itemCenterX <= region.xMax) {
					assigned = true;
					break;
				}
			}
		}

		results.push({ text: item.text.trim(), bbox, assigned });
	}

	return results;
}
