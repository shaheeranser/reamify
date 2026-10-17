# Reamify

[![npm version](https://img.shields.io/npm/v/@shaheeranser/reamify.svg)](https://www.npmjs.com/package/@shaheeranser/reamify)
[![npm downloads](https://img.shields.io/npm/dm/@shaheeranser/reamify.svg)](https://www.npmjs.com/package/@shaheeranser/reamify)
[![license](https://img.shields.io/npm/l/@shaheeranser/reamify.svg)](./LICENSE)

**Turn PDF tables into clean XLSX workbooks — with memory that stays flat no
matter how many pages the document has.**

Reamify is a Node.js library for extracting tabular data from PDFs into Excel
workbooks. Unlike tools that dump every text line into a single column, Reamify
reconstructs real tables — rows, columns, detected header rows, repeated-header
de-duplication and multi-line headers included — and writes them with ExcelJS's
streaming workbook writer.

It is designed for large documents. A 1,354-page government budget export
converts in **under two minutes using ~556 MiB**; a comparable line-based tool
needs **~5.6 GiB**. Peak memory stays roughly constant as page count grows.

- **Structured output** — regions, rows and columns, not a wall of text.
- **Bounded memory** — at most one page's rows are held at a time; the rest of
  the page stream spills to a temporary file that is deleted afterwards.
- **Streaming writer** — workbooks are written incrementally through ExcelJS.
- **Multi-region pages** — separate stacked or side-by-side tables on one page.
- **Safe by default** — uncertain content is reported through warnings and
  diagnostics, never silently dropped.
- **No browser dependency for the writer** — `convertPages` accepts
  pre-extracted page rows and runs anywhere.

Built on [`@firecrawl/pdf-inspector`](https://www.npmjs.com/package/@firecrawl/pdf-inspector)
for PDF text geometry and [`exceljs`](https://www.npmjs.com/package/exceljs) for
workbook generation.

## Installation

```bash
npm install @shaheeranser/reamify
```

Requires Node.js 18 or newer (the package is ESM-only).

## Quick start

`convertPdf` accepts a PDF `Buffer` and returns an XLSX `Buffer` (or writes to a
file/stream):

```ts
import { readFile } from 'node:fs/promises';
import { convertPdf } from '@shaheeranser/reamify';

const pdf = await readFile('input.pdf');
const xlsx = await convertPdf(pdf);
```

For large documents, stream the workbook straight to disk:

```ts
await convertPdf(await readFile('statement.pdf'), {
  filename: 'statement.xlsx',
  includePageColumn: true, // add the source page number to each row
});
```

Inspect what happened during conversion:

```ts
await convertPdf(pdf, {
  filename: 'out.xlsx',
  onWarning: (warning) => console.warn(warning.kind, warning.message),
  onDiagnostics: (diagnostics) => console.log(diagnostics.totalRows, diagnostics.tierCounts),
});
```

## How it works

1. The PDF is read in small batches of pages (`batchSize`, default 4) so the
   native inspector never holds the whole document's text in memory at once.
2. Text is grouped into table **regions** on each page, then into rows and
   columns, with header rows detected.
3. Regions from adjacent pages are merged, repeated headers are de-duplicated,
   and multi-line headers are reconstructed.
4. Rows are streamed to an ExcelJS workbook; the page stream is buffered only
   up to `spillThresholdBytes` (default 32 MiB) before spilling to a temp file.

### Extraction modes

The `extraction` option controls how tables are found:

| Mode | Description |
| --- | --- |
| `clustered` *(default)* | Region discovery, row clustering and column inference run entirely in JavaScript. Fast and complete on text-based tables. |
| `auto` | Adds the native table-detection tiers (vector grids and structure mining) for ruled or scanned PDFs. |
| `positions` | Position-only page builder (the original geometry path). |
| `markdown-legacy` | The original markdown-table path, retained for compatibility. |

`auto` validates every native result against the JavaScript baseline and rejects
any result that would drop text, emitting a `tier-incomplete` warning. It is
therefore never less complete than `clustered`, but the native calls re-parse
the document and are considerably slower, which is why `clustered` is the
default.

## Memory and performance

Peak memory is bounded by the number of pages held in a batch and the writer's
spill budget — **not** by the document's total length. Measured peak RSS
(including Node's ~85 MiB baseline) is roughly constant across document sizes:

| Document | Pages | reamify peak RSS | reamify time |
| --- | ---: | ---: | ---: |
| arXiv 1706.03762 | 15 | 142 MiB | 1.3 s |
| IRS Publication 17 | 142 | 477 MiB | 27 s |
| GovInfo ERP-2023 | 513 | 343 MiB | 52 s |
| Defaulters list | 757 | 490 MiB | 91 s |
| GovInfo BUDGET-2024 | 1,354 | 556 MiB | 112 s |

Tune `batchSize` down (e.g. `1`) to trade a little wall-clock for a lower
memory floor, and `spillThresholdBytes` to `0` to always keep pages on disk.

## Evaluation

Reamify is compared against the [`pdf-to-excel`](https://www.npmjs.com/package/pdf-to-excel)
npm package over a curated corpus of public, text-based PDFs (arXiv papers, IRS
forms and publications, government reports, Tabula test tables) plus generated
ground-truth fixtures. The harness measures wall-clock time, peak RSS, a
text-coverage accuracy proxy, and exact-grid accuracy; it lives in
[`scripts/eval/`](./scripts/eval) and is documented in
[docs/evaluation-harness.md](./docs/evaluation-harness.md).

Reproduce it with:

```bash
npm run eval
```

### Accuracy

Coverage is the token recall/precision/F1 of the workbook text against the
PDF's own embedded text layer, and exact-grid is a strict cell-by-cell match on
the generated fixtures where the expected grid is known:

| Metric | reamify | pdf-to-excel |
| --- | ---: | ---: |
| Mean coverage F1 (21 documents) | **98.8%** | 94.8% |
| Exact ground-truth grids | **2 / 2** | 1 / 2 |

`pdf-to-excel` writes one row per detected text line without separating
columns, so it retains text (high recall) but scores lower precision and emits
many more cells.

### Memory and time on large documents

| Document | Pages | reamify time | pdf-to-excel time | reamify peak RSS | pdf-to-excel peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| GovInfo BUDGET-2024 | 1,354 | **112 s** | 317 s | **556 MiB** | 5,649 MiB |
| GovInfo ERP-2023 | 513 | 52 s | **33 s** | **343 MiB** | 816 MiB |
| Defaulters list | 757 | 91 s | **79 s** | **490 MiB** | 1,058 MiB |
| IRS Publication 17 | 142 | 27 s | **14 s** | 477 MiB | **422 MiB** |
| arXiv 1706.03762 | 15 | **1.3 s** | 3.0 s | **142 MiB** | 173 MiB |

Numbers are from single runs on one machine and include the process baseline;
treat them as indicative, not absolute. The headline result is memory:
Reamify's peak RSS stays in the hundreds of MiB regardless of page count, while
the line-based tool grows into the gigabytes.

## Convert pre-extracted pages

When PDF extraction happens elsewhere, `convertPages` accepts any synchronous or
asynchronous iterable of `string[][]` pages — the browser-compatible entry point:

```ts
import { convertPages } from '@shaheeranser/reamify';

const workbook = await convertPages(pageRowStream, { sheetName: 'Tables' });
```

## Options

`convertPdf` accepts the following options; `convertPages` accepts the workbook
options.

| Option | Default | Description |
| --- | --- | --- |
| `sheetName` | `Extracted tables` | Worksheet name. |
| `includePageColumn` | `false` | Add the one-based source page number to each row. |
| `includeEntryColumn` | `false` | Add the region/entry index to each row. |
| `filename` | – | Write the workbook to this path (Node.js). |
| `stream` | – | Write the workbook to a writable stream. |
| `worksheetPolicy` | `auto` | `auto`, `per-region`, or `stacked`. |
| `pageNumbers` | all | Zero-based page indices to extract. |
| `batchSize` | `4` | Pages of text held by the inspector at once. |
| `extraction` | `clustered` | `clustered`, `auto`, `positions`, or `markdown-legacy`. |
| `keepRepeatedHeaders` | `false` | Keep repeated header rows instead of de-duplicating. |
| `mergeContinuations` | `true` | Merge tables that continue across pages. |
| `spillThresholdBytes` | `33554432` | Bytes of the page stream kept in memory before spilling. |
| `onWarning` | – | Called for each `ConversionWarning`. |
| `onDiagnostics` | – | Called once with `ConversionDiagnostics` after conversion. |

## Public API

- `convertPdf(pdf, options?)` → `Promise<Buffer | ArrayBuffer | void>` — convert a
  PDF buffer.
- `convertPages(pages, options?)` → `Promise<Buffer | ArrayBuffer | void>` —
  convert pre-extracted page rows.
- `convert` — alias for `convertPdf`.
- Types: `ConvertOptions`, `WorkbookOptions`, `WorksheetPolicy`, `ExtractionMode`,
  `ConversionWarning`, `WarningKind`, `ConversionDiagnostics`, and more.

`markdownToRows` remains available as a deprecated compatibility export.

## Development

```bash
npm install
npm run build
npm test
npm run eval        # run the comparison harness (see docs/evaluation-harness.md)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidance.

## License

MIT. See [LICENSE](./LICENSE).
