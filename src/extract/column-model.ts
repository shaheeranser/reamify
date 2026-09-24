/**
 * Document-scoped model of how many columns this PDF's tables have.
 *
 * Tier B accepts pdf-inspector's markdown table only when it is at least as
 * wide as the table is expected to be. Deriving that expectation from the
 * region being validated is circular: a region that has already been split
 * off from its table reports fewer columns than the table really has, so the
 * gate happily accepts a truncated markdown row. Recording the counts seen
 * across the document gives an expectation that does not move with any one
 * region's geometry.
 *
 * The model is document-agnostic: it learns the count rather than assuming
 * one, and reports "not established" until it has enough observations to
 * mean anything, so a one-off table still falls back to its own count.
 *
 * The gate it feeds only chooses between Tier B (markdown) and Tier C
 * (positional clustering); when in doubt it rejects markdown, which is the
 * conservative choice because Tier C reads columns from the page geometry.
 */

export interface ColumnCountModel {
	/** Record one region's header-derived column count. */
	observe(count: number): void;
	/** Most common observed column count, or 0 when not yet established. */
	expected(): number;
}

/**
 * Observations needed before the model is trusted. Below this, callers
 * should use their local column count: a single table must not be forced to
 * match itself.
 */
const MIN_OBSERVATIONS = 3;

export function createColumnCountModel(): ColumnCountModel {
	const counts = new Map<number, number>();
	let total = 0;

	return {
		observe(count: number): void {
			// A region needs at least two columns for its width to be
			// meaningful evidence of a table schema.
			if (!Number.isFinite(count) || count < 2) return;
			counts.set(count, (counts.get(count) ?? 0) + 1);
			total++;
		},
		expected(): number {
			if (total < MIN_OBSERVATIONS) return 0;
			let best = 0;
			let bestCount = -1;
			for (const [cols, n] of counts) {
				// Ties resolve to the wider table: rejecting markdown is safe
				// (Tier C takes over), accepting a truncated one is not.
				if (n > bestCount || (n === bestCount && cols > best)) {
					best = cols;
					bestCount = n;
				}
			}
			return best;
		},
	};
}
