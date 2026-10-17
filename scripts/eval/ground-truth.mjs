/**
 * Generate small, fully controlled ground-truth PDFs with pdfkit and record
 * the exact expected grid for each. Because the documents are generated here,
 * the ground truth is reproducible without committing binary fixtures.
 */

import fs from 'node:fs';
import path from 'node:path';
import { groundTruthDir, ensureDir, sandboxRequire } from './sandbox.mjs';

const PDFDocument = sandboxRequire('pdfkit');

async function render(pdfPath, draw) {
	const doc = new PDFDocument({ size: 'A4', margin: 0 });
	const stream = fs.createWriteStream(pdfPath);
	doc.pipe(stream);
	draw(doc);
	doc.end();
	await new Promise((resolve, reject) => {
		stream.on('finish', resolve);
		stream.on('error', reject);
	});
}

function drawTable(doc, x, y, columns, rows, { headerBold = true } = {}) {
	const step = 22;
	let cursor = y;
	if (headerBold) doc.font('Helvetica-Bold');
	doc.fontSize(10);
	columns.forEach((value, index) => doc.text(value, x[index], cursor, { lineBreak: false }));
	cursor += step;
	doc.font('Helvetica');
	for (const row of rows) {
		row.forEach((value, index) => doc.text(value, x[index], cursor, { lineBreak: false }));
		cursor += step;
	}
	return cursor;
}

const SIMPLE_COLUMNS = ['Invoice', 'Client', 'Amount', 'Status'];
const SIMPLE_X = [40, 170, 320, 430];

const PAGES_COLUMNS = ['Contract', 'Vendor', 'Value', 'Region'];
const PAGES_X = [40, 160, 320, 440];

function buildFixtures() {
	return [
		{
			id: 'gt-simple-table',
			notes: 'Single ruled table, bold header, five data rows.',
			expectedGrid: [
				SIMPLE_COLUMNS,
				['INV-1001', 'Acme', '1250.00', 'Paid'],
				['INV-1002', 'Globex', '980.50', 'Due'],
				['INV-1003', 'Initech', '430.00', 'Paid'],
				['INV-1004', 'Umbrella', '2100.75', 'Overdue'],
				['INV-1005', 'Soylent', '75.25', 'Due'],
			],
			draw(doc) {
				drawTable(doc, SIMPLE_X, 80, SIMPLE_COLUMNS, [
					['INV-1001', 'Acme', '1250.00', 'Paid'],
					['INV-1002', 'Globex', '980.50', 'Due'],
					['INV-1003', 'Initech', '430.00', 'Paid'],
					['INV-1004', 'Umbrella', '2100.75', 'Overdue'],
					['INV-1005', 'Soylent', '75.25', 'Due'],
				]);
			},
		},
		{
			id: 'gt-two-pages',
			notes: 'Same header repeated on two pages; header should be de-duplicated.',
			expectedGrid: [
				PAGES_COLUMNS,
				['C-01', 'Northwind', '10000', 'North'],
				['C-02', 'Contoso', '20000', 'South'],
				['C-03', 'Fabrikam', '30000', 'East'],
				['C-04', 'Tailspin', '40000', 'West'],
				['C-05', 'Litware', '50000', 'North'],
				['C-06', 'Proseware', '60000', 'South'],
				['C-07', 'Adventure', '70000', 'East'],
				['C-08', 'Wingtip', '80000', 'West'],
			],
			draw(doc) {
				drawTable(doc, PAGES_X, 80, PAGES_COLUMNS, [
					['C-01', 'Northwind', '10000', 'North'],
					['C-02', 'Contoso', '20000', 'South'],
					['C-03', 'Fabrikam', '30000', 'East'],
					['C-04', 'Tailspin', '40000', 'West'],
				]);
				doc.addPage();
				drawTable(doc, PAGES_X, 110, PAGES_COLUMNS, [
					['C-05', 'Litware', '50000', 'North'],
					['C-06', 'Proseware', '60000', 'South'],
					['C-07', 'Adventure', '70000', 'East'],
					['C-08', 'Wingtip', '80000', 'West'],
				]);
			},
		},
	];
}

export async function generateGroundTruth() {
	ensureDir(groundTruthDir);
	const fixtures = [];

	for (const fixture of buildFixtures()) {
		const pdfPath = path.join(groundTruthDir, `${fixture.id}.pdf`);
		await render(pdfPath, fixture.draw);
		fixtures.push({ id: fixture.id, notes: fixture.notes, pdfPath, expectedGrid: fixture.expectedGrid });
	}

	fs.writeFileSync(
		path.join(groundTruthDir, 'expected.json'),
		`${JSON.stringify({ fixtures: fixtures.map((f) => ({ id: f.id, notes: f.notes, pdf: path.basename(f.pdfPath), expectedGrid: f.expectedGrid })) }, null, 2)}\n`,
		'utf8',
	);

	return fixtures;
}
