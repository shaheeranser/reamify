/**
 * Post-extraction, pre-export processing pipeline.
 *
 * The steps are intentionally ordered: header reconstruction first, then
 * repeated-header filtering, and finally serial renumbering for output.
 */

import type { PageLayout, TableRegion, TableRow, TableCell, BBox } from '../types.js';

/** Normalize a string for comparison: trim, lowercase, collapse whitespace. */
export function normalize(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

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

/** Normalized non-empty cell texts from a row, ignoring column gaps. */
export function rowLabelSet(row: TableRow): Set<string> {
	const labels = new Set<string>();
	for (const cell of row.cells) {
		const n = normalize(cell.text);
		if (n) labels.add(n);
	}
	return labels;
}

/**
 * True when every label in `parts` already appears in an emitted schema
 * (or in the document canonical header, once that header has been kept).
 * Truncated / split repeats such as a 4-column copy of a 5-column header
 * are treated as the same logical schema, not a new table.
 */
function coveredByEmittedSchema(parts: Set<string>, emitted: Set<string>[]): boolean {
	if (parts.size === 0 || emitted.length === 0) return false;
	return emitted.some((schema) => {
		for (const p of parts) {
			if (!schema.has(p)) return false;
		}
		return true;
	});
}

/**
 * Remove header rows after the first occurrence of each distinct schema.
 *
 * Scope is the whole output, not each page-region: a later region's
 * `isHeader` row is dropped even if it is that region's local index 0.
 * A truncated or fragmented copy of an already-emitted schema (subset of
 * its labels) is also dropped, so split last-column headers cannot sneak
 * through as a "new" table.
 */
export function filterRepeatedHeaders(
	layouts: PageLayout[],
	canonicalLabels: string[],
): void {
	const headerSig = buildSignature(canonicalLabels);
	if (!headerSig) return;

	const canonicalParts = new Set(
		canonicalLabels.map(normalize).filter((s) => s.length > 0),
	);
	// Document-wide: first kept header of each distinct schema. Canonical
	// labels are seeded so subset matches work even before the first row
	// is classified, once at least one header has been emitted.
	const emittedSchemas: Set<string>[] = [];

	for (const layout of layouts) {
		for (const region of layout.regions) {
			const localHeaderSigs = new Set<string>();
			for (const row of region.rows) {
				if (row.isHeader) {
					localHeaderSigs.add(rowSignature(row));
				}
			}

			region.rows = region.rows.filter((row) => {
				const sig = rowSignature(row);
				const parts = rowLabelSet(row);
				const subsetOfCanonical = parts.size > 0
					&& [...parts].every((p) => canonicalParts.has(p));
				const isRepeatOfEmitted = coveredByEmittedSchema(parts, emittedSchemas)
					|| (emittedSchemas.length > 0 && subsetOfCanonical);
				const looksLikeHeader = sig === headerSig
					|| localHeaderSigs.has(sig)
					|| isRepeatOfEmitted;

				if (!looksLikeHeader) return true;

				// Keep only the first header of a schema that is not a subset
				// of one already written (document scope, not per-region idx).
				if (row.isHeader && !isRepeatOfEmitted) {
					emittedSchemas.push(parts.size > 0 ? parts : new Set(sig.split('|')));
					return true;
				}
				return false;
			});

			for (let i = 0; i < region.rows.length; i++) {
				region.rows[i]!.index = i;
			}
		}
	}
}


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

/**
 * Run the postprocessing pipeline in the fixed order required for stable output.
 *
 * @param layouts - PageLayout array (mutated in place).
 * @returns The canonical header labels, or null if none were found.
 */
export function postprocessLayouts(layouts: PageLayout[]): string[] | null {
	const canonicalLabels = reconstructMultiLineHeaders(layouts);

	if (canonicalLabels) {
		filterRepeatedHeaders(layouts, canonicalLabels);
	}

	renumberSerials(layouts);

	return canonicalLabels;
}
