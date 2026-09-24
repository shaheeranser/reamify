import type { PageLayout, TableRegion, TableRow, OnWarning } from '../types.js';

export function headerBlockSignature(rows: TableRow[]): string {
	const headerRows: TableRow[] = [];
	for (const r of rows) {
		if (r.isHeader) headerRows.push(r);
		else break;
	}
	if (headerRows.length === 0) return '';

	let maxCol = 0;
	for (const r of headerRows) {
		for (const c of r.cells) if (c.column > maxCol) maxCol = c.column;
	}

	const colTexts: string[] = Array(maxCol + 1).fill('');
	for (const r of headerRows) {
		for (const c of r.cells) {
			const t = c.text.trim().toLowerCase().replace(/\s+/g, ' ');
			if (t) colTexts[c.column] = colTexts[c.column] ? `${colTexts[c.column]} ${t}` : t;
		}
	}
	return colTexts.filter((s) => s.length > 0).join('|');
}

function colCount(region: TableRegion): number {
	let max = 0;
	for (const r of region.rows) {
		for (const c of r.cells) if (c.column + 1 > max) max = c.column + 1;
	}
	return max;
}

function hasInterveningTextHorizontal(layout: PageLayout, x1: number, x2: number, y1: number, y2: number): boolean {
	const all = [...layout.titles.map((t) => t.bbox), ...layout.outsideText.map((o) => o.bbox)];
	return all.some((b) => b[0] < x2 && b[2] > x1 && b[1] < y2 && b[3] > y1);
}

export interface SequenceInfo {
	colIndex: number;
	values: number[];
	min: number;
	max: number;
	stepOneRatio: number;
}

/**
 * Checks whether a block contains a column whose values form a strict or near-strict
 * consecutive integer sequence within that block.
 * Detected structurally by value pattern, NOT by header label.
 */
export function detectSequenceColumn(rows: TableRow[]): SequenceInfo | null {
	const dataRows = rows.filter((r) => !r.isHeader);
	if (dataRows.length < 3) return null;

	let maxCol = 0;
	for (const r of dataRows) {
		for (const c of r.cells) if (c.column > maxCol) maxCol = c.column;
	}

	for (let col = 0; col <= maxCol; col++) {
		const parsed: number[] = [];
		let totalCount = 0;

		for (const r of dataRows) {
			const cell = r.cells.find((c) => c.column === col);
			if (!cell || !cell.text.trim()) continue;
			totalCount++;
			const cleaned = cell.text.trim().replace(/,/g, '');
			if (/^-?\d+$/.test(cleaned)) {
				parsed.push(parseInt(cleaned, 10));
			}
		}

		if (totalCount < 3 || parsed.length / totalCount < 0.8) continue;

		let stepOneCount = 0;
		for (let i = 0; i < parsed.length - 1; i++) {
			if (parsed[i + 1]! - parsed[i]! === 1) {
				stepOneCount++;
			}
		}

		const stepOneRatio = parsed.length > 1 ? stepOneCount / (parsed.length - 1) : 0;
		if (stepOneRatio >= 0.8) {
			return {
				colIndex: col,
				values: parsed,
				min: parsed[0]!,
				max: parsed[parsed.length - 1]!,
				stepOneRatio,
			};
		}
	}

	return null;
}

function haveDistinguishingCaptions(layout: PageLayout, regA: TableRegion, regB: TableRegion): boolean {
	const yMargin = 40;
	const getPrecedingText = (reg: TableRegion): string[] => {
		const texts: string[] = [];
		const allText = [
			...layout.titles.map((t) => ({ text: t.text, bbox: t.bbox })),
			...layout.outsideText.map((o) => ({ text: o.text, bbox: o.bbox })),
		];
		for (const t of allText) {
			if (
				t.bbox[3] <= reg.bbox[1] &&
				t.bbox[3] >= reg.bbox[1] - yMargin &&
				t.bbox[0] < reg.bbox[2] &&
				t.bbox[2] > reg.bbox[0]
			) {
				texts.push(t.text.trim().toLowerCase().replace(/\s+/g, ' '));
			}
		}
		return texts;
	};

	const capA = getPrecedingText(regA).join(' ');
	const capB = getPrecedingText(regB).join(' ');

	if (capA && capB && capA !== capB) {
		return true;
	}
	return false;
}

function isSideBySidePatternConsistent(layouts: PageLayout[]): boolean {
	let multiRegionPages = 0;
	let sideBySidePages = 0;

	for (const layout of layouts) {
		if (layout.regions.length <= 1) continue;
		multiRegionPages++;

		const sorted = [...layout.regions].sort((a, b) => a.bbox[0] - b.bbox[0]);
		let hasMatch = false;
		for (let i = 0; i < sorted.length - 1; i++) {
			const a = sorted[i]!;
			const b = sorted[i + 1]!;
			const yTop = Math.max(a.bbox[1], b.bbox[1]);
			const yBottom = Math.min(a.bbox[3], b.bbox[3]);
			if (yBottom > yTop) {
				const sigA = headerBlockSignature(a.rows);
				const sigB = headerBlockSignature(b.rows);
				if ((sigA && sigA === sigB) || (sigA && !sigB && colCount(a) === colCount(b))) {
					hasMatch = true;
					break;
				}
			}
		}
		if (hasMatch) sideBySidePages++;
	}

	if (multiRegionPages === 0) return true;
	return sideBySidePages / multiRegionPages >= 0.5;
}

export type MergeTier = 'sequence-confirmed' | 'heuristic' | 'flagged-ambiguous';
export type MergeDirection = 'stack-right-under-left' | 'parallel-end-to-end' | 'none';

export interface MergeDecision {
	page: number;
	leftRegionId: number;
	rightRegionId: number;
	tier: MergeTier;
	merged: boolean;
	direction: MergeDirection;
	reason: string;
}

export interface MergeReport {
	decisions: MergeDecision[];
	totalMerged: number;
	tierCounts: {
		sequenceConfirmed: number;
		heuristic: number;
		flaggedAmbiguous: number;
	};
	confirmedDirection: MergeDirection;
}

let lastMergeReport: MergeReport = {
	decisions: [],
	totalMerged: 0,
	tierCounts: {
		sequenceConfirmed: 0,
		heuristic: 0,
		flaggedAmbiguous: 0,
	},
	confirmedDirection: 'none',
};

export function getLastMergeReport(): MergeReport {
	return lastMergeReport;
}

function evaluateSideBySideMerge(
	regA: TableRegion,
	regB: TableRegion,
	layout: PageLayout,
	patternConsistent: boolean,
): { shouldMerge: boolean; tier: MergeTier; direction: MergeDirection; reason: string } {
	if (regB.bbox[0] < regA.bbox[0]) {
		return { shouldMerge: false, tier: 'flagged-ambiguous', direction: 'none', reason: 'Not horizontal' };
	}

	const yTop = Math.max(regA.bbox[1], regB.bbox[1]);
	const yBottom = Math.min(regA.bbox[3], regB.bbox[3]);
	if (yBottom <= yTop) {
		return { shouldMerge: false, tier: 'flagged-ambiguous', direction: 'none', reason: 'No vertical overlap' };
	}

	if (hasInterveningTextHorizontal(layout, regA.bbox[2], regB.bbox[0], yTop, yBottom)) {
		return { shouldMerge: false, tier: 'flagged-ambiguous', direction: 'none', reason: 'Intervening text between blocks' };
	}

	const sigA = headerBlockSignature(regA.rows);
	const sigB = headerBlockSignature(regB.rows);

	const headersMatch = (sigA && sigB && sigA === sigB) || (sigA && !sigB && colCount(regA) === colCount(regB));
	if (!headersMatch) {
		return { shouldMerge: false, tier: 'flagged-ambiguous', direction: 'none', reason: 'Header signatures do not match' };
	}

	// Tier 1 — Intrinsic sequence signal
	const seqA = detectSequenceColumn(regA.rows);
	const seqB = detectSequenceColumn(regB.rows);

	if (seqA || seqB) {
		const sA = seqA ?? detectSequenceColumn(regA.rows);
		const sB = seqB ?? detectSequenceColumn(regB.rows);

		if (sA && sB && sA.colIndex === sB.colIndex) {
			const lastA = sA.max;
			const firstB = sB.min;

			if (firstB >= lastA && firstB <= lastA + 3) {
				return {
					shouldMerge: true,
					tier: 'sequence-confirmed',
					direction: 'stack-right-under-left',
					reason: `Consecutive sequence in col ${sA.colIndex} (${lastA} -> ${firstB}) confirms stack right under left per page`,
				};
			}

			if (firstB > lastA + 10) {
				return {
					shouldMerge: false,
					tier: 'sequence-confirmed',
					direction: 'parallel-end-to-end',
					reason: `Sequence in col ${sA.colIndex} (${lastA} vs ${firstB}) indicates parallel running columns across document`,
				};
			}
		}
	}

	// Tier 2 — Fallback heuristic
	const distinguishingCaptions = haveDistinguishingCaptions(layout, regA, regB);
	if (!distinguishingCaptions && patternConsistent) {
		return {
			shouldMerge: true,
			tier: 'heuristic',
			direction: 'stack-right-under-left',
			reason: 'Matching headers, no distinguishing captions, and consistent side-by-side pattern across document',
		};
	}

	// Tier 3 — Ambiguous
	return {
		shouldMerge: false,
		tier: 'flagged-ambiguous',
		direction: 'none',
		reason: distinguishingCaptions
			? 'Distinguishing captions differ between blocks'
			: 'Side-by-side pattern not consistently recurring across document',
	};
}

export function mergeTableRegions(layouts: PageLayout[], onWarning?: OnWarning): PageLayout[] {
	const result = mergeTableRegionsWithReport(layouts, onWarning);
	return result.layouts;
}

export function mergeTableRegionsWithReport(
	layouts: PageLayout[],
	onWarning?: OnWarning,
): { layouts: PageLayout[]; report: MergeReport } {
	const report: MergeReport = {
		decisions: [],
		totalMerged: 0,
		tierCounts: {
			sequenceConfirmed: 0,
			heuristic: 0,
			flaggedAmbiguous: 0,
		},
		confirmedDirection: 'none',
	};

	if (layouts.length === 0) {
		lastMergeReport = report;
		return { layouts, report };
	}

	const patternConsistent = isSideBySidePatternConsistent(layouts);

	for (const layout of layouts) {
		if (layout.regions.length <= 1) continue;
		layout.regions.sort((a, b) => a.bbox[0] - b.bbox[0]);

		let i = 0;
		while (i < layout.regions.length - 1) {
			const a = layout.regions[i]!;
			const b = layout.regions[i + 1]!;

			const decision = evaluateSideBySideMerge(a, b, layout, patternConsistent);
			report.decisions.push({
				page: layout.page,
				leftRegionId: a.id,
				rightRegionId: b.id,
				tier: decision.tier,
				merged: decision.shouldMerge,
				direction: decision.direction,
				reason: decision.reason,
			});

			if (decision.tier === 'sequence-confirmed') {
				report.tierCounts.sequenceConfirmed++;
			} else if (decision.tier === 'heuristic') {
				report.tierCounts.heuristic++;
			} else {
				report.tierCounts.flaggedAmbiguous++;
			}

			if (decision.shouldMerge) {
				report.totalMerged++;
				report.confirmedDirection = decision.direction;

				// Append b's data rows into a
				const bDataRows = b.rows.filter((r) => !r.isHeader);
				for (const r of bDataRows) {
					a.rows.push({ ...r, index: a.rows.length });
				}
				a.bbox = [
					Math.min(a.bbox[0], b.bbox[0]),
					Math.min(a.bbox[1], b.bbox[1]),
					Math.max(a.bbox[2], b.bbox[2]),
					Math.max(a.bbox[3], b.bbox[3]),
				];
				layout.regions.splice(i + 1, 1);
			} else {
				if (decision.tier === 'flagged-ambiguous') {
					onWarning?.({
						kind: 'table-merge-ambiguous' as any,
						page: layout.page,
						message: `possible split table, not auto-merged: ${decision.reason}`,
						regionId: b.id,
					});
				}
				i++;
			}
		}
	}

	let baseId = 0;
	let prevPage = -1;
	let prevHadRegions = false;
	let prevMaxY = 0;
	let prevRegionsCount = 0;
	let prevLayout: PageLayout | null = null;

	for (const layout of layouts) {
		if (layout.regions.length === 0) {
			const hasText = layout.titles.length > 0 || layout.outsideText.length > 0;
			if (hasText && prevHadRegions) {
				baseId += Math.max(prevRegionsCount, 1);
				prevHadRegions = false;
			}
			continue;
		}

		if (prevHadRegions && layout.page === prevPage + 1 && prevLayout) {
			const topY = Math.min(...layout.regions.map((r) => r.bbox[1]));
			const textAtTop = [...layout.titles, ...layout.outsideText].some((t) => t.bbox[3] <= topY);
			const textAtPrevBottom = [...prevLayout.titles, ...prevLayout.outsideText].some((t) => t.bbox[1] >= prevMaxY);
			if (textAtTop || textAtPrevBottom) {
				baseId += Math.max(prevRegionsCount, 1);
			}
		} else if (prevHadRegions && layout.page > prevPage + 1) {
			baseId += Math.max(prevRegionsCount, 1);
		}

		for (let rIdx = 0; rIdx < layout.regions.length; rIdx++) {
			layout.regions[rIdx]!.id = baseId + rIdx;
		}

		prevPage = layout.page;
		prevHadRegions = true;
		prevMaxY = Math.max(...layout.regions.map((r) => r.bbox[3]));
		prevRegionsCount = layout.regions.length;
		prevLayout = layout;
	}

	lastMergeReport = report;
	return { layouts, report };
}
