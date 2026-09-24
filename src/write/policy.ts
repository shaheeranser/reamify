import type { PageLayout, WorksheetPolicy, OnWarning, TableRow } from '../types.js';
import { headerBlockSignature } from '../extract/merge.js';

export { headerBlockSignature };

export function resolvePolicy(
	policy: WorksheetPolicy,
	layouts: PageLayout[],
	onWarning?: OnWarning,
): 'per-region' | 'stacked' {
	if (policy === 'per-region') return 'per-region';
	if (policy === 'stacked') return 'stacked';

	const regionCounts = layouts
		.filter((l) => l.regions.length > 0)
		.map((l) => l.regions.length);

	if (regionCounts.length === 0) return 'stacked';

	const allSame = regionCounts.every((c) => c === regionCounts[0]);

	if (!allSame) {
		onWarning?.({
			kind: 'region-count-unstable',
			page: -1,
			message: `Region count varies across pages (${[...new Set(regionCounts)].join(', ')}), using stacked layout`,
		});
		return 'stacked';
	}

	return 'per-region';
}

export function headerSignature(row: TableRow): string {
	return row.cells.map((c) => c.text.toLowerCase().trim()).join('|');
}
