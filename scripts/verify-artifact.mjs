import ExcelJS from 'exceljs';

const path = process.argv[2];
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);
const ws = wb.worksheets[0];
console.log(`file: ${path}`);
console.log(`sheet: ${ws.name}  rowCount=${ws.rowCount}  columnCount=${ws.columnCount}`);

console.log('\nfirst 8 rows:');
let n = 0;
ws.eachRow({ includeEmpty: true }, (row) => {
	if (n++ >= 8) return;
	const all = [];
	row.eachCell({ includeEmpty: true }, (cell) => all.push(cell.value ?? ''));
	console.log(`  ${JSON.stringify(all)}`);
});

const hist = {};
let oneCellNumeric = 0;
let fourCells = 0;
let contractRows = 0;
const oneExamples = [];
ws.eachRow({ includeEmpty: true }, (row) => {
	const vals = [];
	let maxCol = 0;
	row.eachCell({ includeEmpty: true }, (cell, col) => {
		vals[col - 1] = cell.value;
		if (cell.value !== null && cell.value !== undefined && cell.value !== '') maxCol = col;
	});
	const nonEmpty = vals.slice(0, maxCol).filter((v) => v !== null && v !== undefined && v !== '').length;
	hist[nonEmpty] = (hist[nonEmpty] || 0) + 1;
	if (nonEmpty === 1 && /^\d+$/.test(String(vals[0]))) {
		oneCellNumeric++;
		if (oneExamples.length < 5) oneExamples.push(row.number);
	}
	if (nonEmpty === 4) fourCells++;
	// A "record" row starts with a contract number (7-8 digits).
	if (/^\d{7,8}$/.test(String(vals[0] ?? ''))) contractRows++;
});
console.log('\nhistogram of non-empty-cell count per row:');
for (const k of Object.keys(hist).sort((a, b) => a - b)) console.log(`  ${k} cells: ${hist[k]}`);
console.log(`\nrows with a single numeric cell (orphan attempts): ${oneCellNumeric} examples at rows ${oneExamples.join(', ')}`);
console.log(`rows with exactly 4 non-empty cells: ${fourCells}`);
console.log(`rows starting with a contract number (7-8 digits): ${contractRows}`);
