# REAMIFY

Memory-conscious PDF table extraction to XLSX using `@firecrawl/pdf-inspector` and `exceljs`.

## Node.js PDF conversion

`convertPdf` asks pdf-inspector for page-level markdown. Each page is converted to rows and handed to the workbook writer before the next page is processed. Table and multi-column layout heuristics come from pdf-inspector, so separate columns are not flattened by a plain text extraction pass.

```ts
import { readFile } from 'node:fs/promises';
import { convertPdf } from 'reamify';

const pdf = await readFile('input.pdf');

await convertPdf(pdf, {
	filename: 'output.xlsx',
	includePageColumn: true,
});
```

Passing `filename` or a Node writable `stream` selects ExcelJS's streaming workbook writer. Rows are committed as they are produced. Without either option, `convertPdf` returns the normal ExcelJS workbook buffer.

## Browser conversion

`pdf-inspector` is a native Node N-API package and cannot run in a browser bundle. Browser applications should extract pages with their PDF/OCR service, then append each page's rows through `convertPages`:

```ts
import { convertPages } from 'reamify';

const xlsx = await convertPages(pageRowStream, {
	sheetName: 'Tables',
});
```

`pageRowStream` can be any sync or async iterable of `string[][]`. The workbook is assembled page-by-page; ExcelJS returns an `ArrayBuffer` in browsers (and a `Buffer` under Node). Browser XLSX generation ultimately needs a final buffer for download because ExcelJS's browser bundle does not expose a writable streaming target.

## Options

- `pageNumbers`: zero-based pages to extract with `convertPdf`.
- `includePageColumn`: prefix each output row with its source page number.
- `sheetName`: name the worksheet.
- `filename` or `stream`: enable Node's low-memory streaming writer.
