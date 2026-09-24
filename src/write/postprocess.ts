/**
 * Post-extraction, pre-export processing pipeline.
 *
 * Runs steps in order:
 * 1. **Header reconstruction** — join multi-line header fragments into one
 *    label per column.
 * 2. **Header-row filter** — drop any row whose cells match the
 *    reconstructed header signature.
 */

import type { PageLayout, TableRegion, TableRow, TableCell, BBox } from '../types.js';

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Normalize a string for comparison: trim, lowercase, collapse whitespace. */
export function normalize(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Step 1: Header reconstruction
// ---------------------------------------------------------------------------

/**
 * For a single region, join multi-line header rows into a single canonical
 * header row. The first header row is mutated to contain the joined
 * labels; subsequent header rows are removed from the region.
 *
 * Returns the canonical header labels (one string per column) or null.
 */
export function reconstructRegionHeaders(region: TableRegion): string[] | null {
	// Collect consecutive header rows at the start of the region.
	const headerRows: TableRow[] = [];
	for (const row of region.rows) {
		if (row.isHeader) headerRows.push(row);
		else break;
	}

	if (headerRows.length === 0) return null;

	// Determine the maximum column index across all header rows.
	let maxCol = 0;
	for (const row of headerRows) {
		for (const cell of row.cells) {
			if (cell.column > maxCol) maxCol = cell.column;
		}
	}

	// Join header text per column across all header rows.
	const colTexts: string[] = Array(maxCol + 1).fill('');
	for (const row of headerRows) {
		for (const cell of row.cells) {
			const t = cell.text.trim();
			if (t) {
				colTexts[cell.column] = colTexts[cell.column]
					? `${colTexts[cell.column]} ${t}`
					: t;
			}
		}
	}

	// Rebuild cells on the first header row with joined text.
	const firstHeader = headerRows[0]!;
	firstHeader.cells = [];
	for (let col = 0; col <= maxCol; col++) {
		if (colTexts[col] && colTexts[col]!.length > 0) {
			firstHeader.cells.push({
				text: colTexts[col]!,
				bbox: [0, 0, 0, 0],
				column: col,
				rowspan: 1,
				colspan: 1,
				isHeader: true,
				confidence: 1.0,
				ambiguous: false,
			});
		}
	}
	firstHeader.cells.sort((a, b) => a.column - b.column);

	// Remove subsequent header rows from the region.
	if (headerRows.length > 1) {
		const toRemove = new Set(headerRows.slice(1));
		region.rows = region.rows.filter((r) => !toRemove.has(r));

		// Reindex remaining rows.
		for (let i = 0; i < region.rows.length; i++) {
			region.rows[i]!.index = i;
		}
	}

	return colTexts;
}

/**
 * For each region, join multi-line header rows into a single canonical
 * header row. The first header row is mutated to contain the joined
 * labels; subsequent header rows are removed from the region.
 *
 * Returns the canonical header labels (one string per column) for use
 * in downstream steps. If no header rows are found, returns null.
 */
export function reconstructMultiLineHeaders(layouts: PageLayout[]): string[] | null {
	let canonicalLabels: string[] | null = null;

	for (const layout of layouts) {
		for (const region of layout.regions) {
			const labels = reconstructRegionHeaders(region);
			if (canonicalLabels === null && labels !== null) {
				canonicalLabels = labels;
			}
		}
	}

	return canonicalLabels;
}

// ---------------------------------------------------------------------------
// Step 2: Header-row filter
// ---------------------------------------------------------------------------

/**
 * Build a normalized signature from a set of labels for matching.
 * The signature is the ordered, normalized cell values joined by '|'.
 */
export function buildSignature(labels: string[]): string {
	return labels.map(normalize).filter((s) => s.length > 0).join('|');
}

/**
 * Build a normalized signature from a TableRow's cell values.
 */
export function rowSignature(row: TableRow): string {
	const maxCol = row.cells.reduce((m, c) => Math.max(m, c.column), -1);
	const values: string[] = Array(maxCol + 1).fill('');
	for (const cell of row.cells) {
		values[cell.column] = cell.text;
	}
	return buildSignature(values);
}

/**
 * Remove any data row whose full cell content matches the canonical
 * header signature. This catches headers that were repeated mid-stream
 * or carried along from merged side-by-side blocks.
 */
export function filterRepeatedHeaders(
	layouts: PageLayout[],
	canonicalLabels: string[],
): void {
	const headerSig = buildSignature(canonicalLabels);
	if (!headerSig) return;

	// Track which header signatures have already been emitted at document
	// scope.  Each distinct header schema (canonical or region-local) is
	// allowed exactly one occurrence; every subsequent match is dropped.
	const emittedHeaderSigs = new Set<string>();

	for (const layout of layouts) {
		for (const region of layout.regions) {
			// Collect the header signature(s) from this region's own header rows.
			const localHeaderSigs = new Set<string>();
			for (const row of region.rows) {
				if (row.isHeader) {
					localHeaderSigs.add(rowSignature(row));
				}
			}

			region.rows = region.rows.filter((row) => {
				const sig = rowSignature(row);
				const matches = sig === headerSig || localHeaderSigs.has(sig);
				if (matches) {
					// Keep the very first occurrence of each distinct header
					// schema across the entire document; drop all repeats.
					if (row.isHeader && !emittedHeaderSigs.has(sig)) {
						emittedHeaderSigs.add(sig);
						return true;
					}
					// Drop repeated header row (from merged second block or repeated in data)
					return false;
				}
				return true;
			});

			// Reindex remaining rows.
			for (let i = 0; i < region.rows.length; i++) {
				region.rows[i]!.index = i;
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Step 3: Serial renumbering (optional utility)
// ---------------------------------------------------------------------------

/**
 * Walk all surviving data rows in document order and assign sequential
 * entry numbers starting at 1.
 *
 * Returns the total entry count.
 */
export function renumberSerials(layouts: PageLayout[]): number {
	let counter = 0;
	for (const layout of layouts) {
		for (const region of layout.regions) {
			for (const row of region.rows) {
				if (!row.isHeader) {
					counter++;
					row.index = counter;
				}
			}
		}
	}
	return counter;
}

// ---------------------------------------------------------------------------
// Combined pipeline
// ---------------------------------------------------------------------------

/**
 * Run postprocessing steps in order.
 *
 * @param layouts - PageLayout array (mutated in place).
 * @returns The canonical header labels, or null if none were found.
 */
export function postprocessLayouts(layouts: PageLayout[]): string[] | null {
	// Step 1: Reconstruct multi-line headers into single rows.
	const canonicalLabels = reconstructMultiLineHeaders(layouts);

	// Step 2: Filter repeated header rows from the data stream.
	if (canonicalLabels) {
		filterRepeatedHeaders(layouts, canonicalLabels);
	}

	// Step 3: Renumber serials on surviving data rows.
	renumberSerials(layouts);

	return canonicalLabels;
}
