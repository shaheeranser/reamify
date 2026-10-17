# Reamify

Reamify converts PDF table data to XLSX workbooks for Node.js applications. It uses `@firecrawl/pdf-inspector` for PDF extraction and `exceljs` for workbook generation.

## Installation

```bash
npm install reamify
```

## Convert a PDF

`convertPdf` accepts a PDF `Buffer` and returns an XLSX `Buffer`, `ArrayBuffer`, or no value when writing to a file or stream.

```ts
import { readFile } from 'node:fs/promises';
import { convertPdf } from 'reamify';

const workbook = await convertPdf(await readFile('input.pdf'));
```

For Node.js output, pass `filename` or a writable `stream` to use ExcelJS's streaming workbook writer:

```ts
await convertPdf(await readFile('input.pdf'), {
  filename: 'output.xlsx',
  includePageColumn: true,
});
```

`includePageColumn` adds the one-based source page number to each output row. `pageNumbers` selects zero-based pages. `sheetName` sets the worksheet name. `worksheetPolicy` can be `auto`, `per-region`, or `stacked`; `extraction` can be `auto`, `clustered`, `positions`, or `markdown-legacy`. `clustered` skips the native table-detection calls and builds regions entirely in JS, which is faster for text tables.

## Memory

`convertPdf` processes pages with bounded memory: it holds at most one page's rows in memory, keeping the page stream in a small in-memory budget (`spillThresholdBytes`, default 32 MiB; set to `0` to always spill) and spilling the rest to a temporary file that is deleted afterwards. `batchSize` (default 4) bounds how many pages' text items the native inspector holds at once. Peak memory stays roughly constant as the document grows, and workbook content is unchanged.

## Convert pre-extracted pages

`convertPages` accepts a synchronous or asynchronous iterable of `string[][]` pages. This is the browser-compatible entry point when PDF extraction happens elsewhere.

```ts
import { convertPages } from 'reamify';

const workbook = await convertPages(pageRowStream, {
  sheetName: 'Tables',
});
```

Without `filename` or `stream`, ExcelJS builds the workbook in memory and returns the final buffer. The native `@firecrawl/pdf-inspector` dependency is used by `convertPdf` and is not browser-runnable.

## Public API

The package exports `convertPdf`, `convertPages`, and `convert` (an alias for `convertPdf`), along with the extraction, post-processing, diagnostics, and workbook option types exposed from `src/index.ts`. `markdownToRows` remains available as a deprecated compatibility export.

## Development

```bash
npm install
npm run build
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidance.

## License

MIT. See [LICENSE](./LICENSE).
