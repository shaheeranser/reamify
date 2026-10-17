import { describe, it, expect, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePagesToWorkbook } from '../../src/write/index.js';
import { PageStore } from '../../src/write/page-store.js';
import type { PageLayout, TableRegion, TableRow, TableCell, BBox } from '../../src/types.js';

function makeCell(text: string, col: number, isHeader = false): TableCell {
	return {
		text,
		bbox: [0, 0, 0, 0] as BBox,
		column: col,
		rowspan: 1,
		colspan: 1,
		isHeader,
		confidence: 1.0,
		ambiguous: false,
	};
}

function makeRow(cells: TableCell[], index: number, isHeader = false): TableRow {
	return { index, isHeader, cells };
}

function makeRegion(id: number, page: number, rows: TableRow[], bbox?: BBox): TableRegion {
	return {
		id,
		page,
		bbox: bbox ?? ([0, 0, 100, 100] as BBox),
		source: 'clustered',
		rows,
	};
}

function makeLayout(page: number, regions: TableRegion[]): PageLayout {
	return { page, regions, titles: [], outsideText: [], needsOcr: false };
}

function asBuffer(output: Buffer | ArrayBuffer | void): Buffer {
	return Buffer.from(output as Buffer);
}

/**
 * Logical workbook content. Whole-file byte comparison is not usable because
 * ExcelJS stamps `docProps/core.xml` with the write time; content equality is
 * what the spill path must preserve.
 */
async function workbookShape(output: Buffer | ArrayBuffer | void) {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(asBuffer(output) as Buffer);
	return wb.worksheets.map((ws) => ({
		name: ws.name,
		values: ws.getSheetValues(),
	}));
}

const tmpDirs: string[] = [];

afterEach(async () => {
	for (const dir of tmpDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe('PageStore', () => {
	it('stays in memory under the threshold and round-trips pages', async () => {
		const store = new PageStore({ thresholdBytes: 1024 * 1024 });
		const layout = makeLayout(0, [makeRegion(0, 0, [makeRow([makeCell('A', 0)], 0)])]);
		await store.add(layout);
		expect(store.spilled).toBe(false);

		const pages: PageLayout[] = [];
		for await (const page of store.pages()) pages.push(page);

		expect(pages).toHaveLength(1);
		expect(pages[0]!.regions[0]!.rows[0]!.cells[0]!.text).toBe('A');
		await store.dispose();
	});

	it('spills to a temp file and cleans it up on dispose', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'reamify-store-'));
		tmpDirs.push(directory);

		const store = new PageStore({ thresholdBytes: 0, directory });
		for (let page = 0; page < 5; page++) {
			await store.add(makeLayout(page, [
				makeRegion(0, page, [makeRow([makeCell(`row-${page}`, 0)], 0)]),
			]));
		}
		expect(store.spilled).toBe(true);
		expect((await readdir(directory)).length).toBe(1);

		const pages: PageLayout[] = [];
		for await (const page of store.pages()) pages.push(page);
		expect(pages.map((p) => p.regions[0]!.rows[0]!.cells[0]!.text)).toEqual([
			'row-0', 'row-1', 'row-2', 'row-3', 'row-4',
		]);

		await store.dispose();
		expect((await readdir(directory)).length).toBe(0);
	});
});

describe('bounded writer', () => {
	const repeatedHeader = [
		makeRow([makeCell('Contract No', 0, true), makeCell('IBC Name', 1, true)], 0, true),
	];
	const multiLineHeader = [
		makeRow([makeCell('Contract No', 0, true), makeCell('Outstanding Dues', 1, true)], 0, true),
		makeRow([makeCell('(April-26)', 1, true)], 1, true),
	];

	function fixture(): PageLayout[] {
		return [
			makeLayout(0, [
				makeRegion(0, 0, [
					...multiLineHeader.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) })),
					makeRow([makeCell('P1-D1', 0), makeCell('100', 1)], 2),
				]),
				makeRegion(1, 0, [
					...repeatedHeader.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) })),
					makeRow([makeCell('P1-R1', 0), makeCell('101', 1)], 1),
				], [300, 0, 500, 100] as BBox),
			]),
			makeLayout(1, [
				makeRegion(0, 1, [
					...multiLineHeader.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) })),
					makeRow([makeCell('P2-D1', 0), makeCell('200', 1)], 2),
				]),
			]),
		];
	}

	it('produces identical content whether or not the page stream spills', async () => {
		const inMemory = await writePagesToWorkbook(fixture(), { worksheetPolicy: 'auto' });
		const spilled = await writePagesToWorkbook(fixture(), {
			worksheetPolicy: 'auto',
			spillThresholdBytes: 0,
		});

		expect(await workbookShape(spilled.output)).toEqual(await workbookShape(inMemory.output));
		expect(spilled.diagnostics).toEqual(inMemory.diagnostics);
	});

	it('matches per-region and stacked policies across the spill boundary', async () => {
		for (const worksheetPolicy of ['per-region', 'stacked'] as const) {
			for (const mergeContinuations of [true, false]) {
				const label = `${worksheetPolicy}/merge=${mergeContinuations}`;
				const inMemory = await writePagesToWorkbook(fixture(), {
					worksheetPolicy,
					mergeContinuations,
				});
				const spilled = await writePagesToWorkbook(fixture(), {
					worksheetPolicy,
					mergeContinuations,
					spillThresholdBytes: 0,
				});
				expect(await workbookShape(spilled.output), label).toEqual(
					await workbookShape(inMemory.output),
				);
			}
		}
	});
});
