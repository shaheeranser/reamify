# Evaluation Harness

This document describes the comparison harness under `scripts/eval/` that
benchmarks Reamify against the `pdf-to-excel` npm package over a curated corpus
of public PDFs, on time, peak memory, and accuracy.

## What it measures

For every document and every tool it records three axes:

- **Time**: wall-clock milliseconds for a single conversion, measured in a
  fresh child process.
- **Memory**: peak resident set size (`VmHWM` from `/proc/self/status`) of that
  child process. This includes Node's ~85 MiB baseline, so compare tools
  against each other rather than reading it as absolute extraction cost.
- **Accuracy**: two complementary signals.
  - *Coverage proxy*: multiset token recall / precision / F1 of the workbook
    text against the PDF's embedded text layer, reconstructed positionally
    with pdf.js. This is a proxy, not ground truth: a tool that spills every
    text line into one column scores high recall even with broken structure.
    Always read it next to the structural columns.
  - *Exact grid*: only for the generated ground-truth PDFs, where the expected
    grid is known exactly. The report states `exact grid` or `differs`;
    `differs` is not automatically wrong (a title row or a de-duplicated header
    can legitimately differ).

Each document/tool pair is run `--warmup` times (discarded) followed by
`--runs` measured times. The report summarizes min / median / mean (and the
aggregate section uses sums of medians) so that one slow outlier does not
dominate.

## Running it

```bash
npm run eval                    # fetch corpus, build, sweep all tools
npm run eval -- --runs=5        # more measured runs
npm run eval -- --heavy         # include large/huge documents
npm run eval -- --only=arxiv-attention,irs-fw9
npm run eval -- --tools=reamify-clustered,pdf-to-excel
npm run eval:fetch -- --only=arxiv-attention   # download only
```

Reports are written to `eval/results/report-<timestamp>.md` and the last output
workbook for each document/tool is kept in `eval/results/artifacts/` for
inspection. Both directories are under the gitignored `eval/`.

## Layout

- `corpus.json`: the curated document list. Each entry has an `id`, a `url`
  (or `localPath`), `tags`, `sizeClass`, and a `heavy` flag. Heavy documents
  are skipped unless `--heavy` is passed.
- `sandbox.mjs`: shared paths plus an installer for evaluation-only
  dependencies (`pdf-to-excel`, `pdfkit`, `pdfjs-dist`) into `eval/harness/`,
  so they never become package dependencies.
- `fetch-corpus.mjs`: downloads the corpus into `eval/corpus/` and writes a
  checksum/shape manifest.
- `ground-truth.mjs`: generates small pdfkit PDFs with known expected grids
  (a single table, and a table whose header repeats across two pages).
- `run-tool.mjs`: child-process entry point; runs one conversion and prints
  timing and peak memory as JSON.
- `metrics.mjs`: tokenization, workbook reading, coverage, and ground-truth
  comparison.
- `harness.mjs`: orchestrator and markdown report writer.

## Notes and limitations

- The comparison is only as fair as the corpus. Coverage rewards tools that
  retain every token, so pair the aggregate with the per-document structural
  columns before drawing conclusions.
- `pdf-to-excel` writes one row per detected text line and does not separate
  columns, which shows up as low precision and high output cell counts.
- `reamify-auto` performs native per-region extraction and is consistently the
  slowest reamify mode; `reamify-clustered` is the pure-JS path.
- Heavy documents (including `eval/Defaulters-List (1).pdf`) are excluded by
  default. Running the `auto` mode over hundreds of pages can take a very long
  time, so restrict `--tools` and raise `--timeout` when evaluating them.
