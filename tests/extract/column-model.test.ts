import { describe, it, expect } from 'vitest';
import { createColumnCountModel } from '../../src/extract/column-model.js';

describe('createColumnCountModel', () => {
	it('is not established until it has enough observations', () => {
		const m = createColumnCountModel();
		m.observe(5);
		m.observe(5);
		expect(m.expected()).toBe(0);
	});

	it('reports the most common column count', () => {
		const m = createColumnCountModel();
		for (const n of [5, 5, 5, 5, 3]) m.observe(n);
		expect(m.expected()).toBe(5);
	});

	it('ignores degenerate counts (single column, zero, non-finite)', () => {
		const m = createColumnCountModel();
		for (const n of [1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) m.observe(n);
		expect(m.expected()).toBe(0);

		for (const n of [4, 4, 4]) m.observe(n);
		expect(m.expected()).toBe(4);
	});

	it('resolves ties to the wider table', () => {
		const m = createColumnCountModel();
		for (const n of [3, 3, 5, 5]) m.observe(n);
		expect(m.expected()).toBe(5);
	});
});
