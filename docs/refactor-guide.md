# Refactor Guide & Project Structure

Date: 2026-09-22
Scope: Code maintainability, structure, and organization. No functional changes proposed.

## 1. Current state assessment

### File inventory

| File | Total lines | Code lines | Comment/blank | Code % | Responsibility |
|---|---:|---:|---:|---:|---|
| `layout-engine.ts` | 575 | 391 | 184 | 68% | Three-tier extraction, batching, page dimensions, bbox merge |
| `region-discovery.ts` | 579 | 328 | 251 | 57% | Region clustering, row banding, column inference, titles, outside text, full layout build, header detection, bbox merge |
| `writer.ts` | 604 | 434 | 170 | 72% | Policy A streaming, Policy A buffer, Policy B streaming, Policy B buffer, legacy writer, PageRows→Layout adapter, policy resolver, header signatures, diagnostics |
| `types.ts` | 137 | 57 | 80 | 42% | All IR types + options |
| `pipeline.ts` | 109 | 67 | 42 | 61% | Routing + convertPages |
| `engine.ts` | 51 | 28 | 23 | 55% | Legacy markdown extraction |
| `index.ts` | 31 | 23 | 8 | 74% | Re-exports |
| `parser.ts` | 26 | 17 | 9 | 65% | markdownToRows |
| **Total** | **2,112** | **1,345** | **767** | **64%** | |

### Problems

1. **Three files exceed 500 lines.** `layout-engine.ts`, `region-discovery.ts`, and `writer.ts` each do too many things. A contributor opening any of them faces a wall of code.

2. **Responsibility overload.** `region-discovery.ts` handles: coordinate conversion, region clustering, row banding, column inference, column assignment, title identification, outside-text assignment, full page layout construction, header detection, and bbox merging — 10 distinct concerns in one file. `writer.ts` has 4 near-duplicate write paths (Policy A × streaming/buffer, Policy B × streaming/buffer).

3. **Comment-to-code ratio is high.** 36% of all lines are comments or blank. Many comments restate what the code does (`// Sort items by x coordinate` above `items.sort((a, b) => a.x - b.x)`). Section banners (`// ---------------------------------------------------------------------------`) add visual noise without conveying information.

4. **Code duplication.** `mergeBBoxes` is implemented identically in both `region-discovery.ts:568` and `layout-engine.ts:564`. The Tier C inline code in `layout-engine.ts:338-398` is a near-copy of `buildPageLayout` in `region-discovery.ts:408-528`.

5. **Flat `src/` directory.** 8 files at the same level with no grouping. The extraction, writing, and IR concerns are not separated by directory.

6. **Test files mirror the flat structure.** Tests are in one `tests/` directory with no grouping matching the source modules.

## 2. Proposed project structure

```
src/
├── index.ts                  # Public API barrel (re-exports only)
├── convert.ts                # convertPdf, convertPages (thin routing)
├── types.ts                  # IR types: BBox, TableCell, TableRow, etc.
│
├── extract/                  # PDF → PageLayout
│   ├── index.ts              # extractPdfPagesLayout (batching loop)
│   ├── tiers.ts              # Tier A/B/C orchestration per region
│   ├── region.ts             # discoverRegions (x-gap clustering)
│   ├── rows.ts               # clusterRows (baseline banding)
│   ├── columns.ts            # inferColumnBoundaries, assignColumn
│   ├── headers.ts            # header detection (multi-line aware)
│   ├── text.ts               # identifyTitles, assignOutsideText
│   └── geometry.ts           # BBox/coordinate utilities shared across extract
│
├── write/                    # PageLayout → XLSX
│   ├── index.ts              # writePagesToWorkbook (dispatcher)
│   ├── policy.ts             # resolvePolicy, schema equivalence check
│   ├── per-region.ts         # Policy A writer (streaming + buffer)
│   ├── stacked.ts            # Policy B writer (streaming + buffer)
│   └── legacy.ts             # PageRows backward-compat adapter + legacy writer
│
└── legacy/                   # Deprecated markdown path
    ├── engine.ts             # extractPdfPages (markdown-based)
    └── parser.ts             # markdownToRows

tests/
├── extract/
│   ├── region.test.ts
│   ├── rows.test.ts
│   ├── columns.test.ts
│   ├── headers.test.ts
│   └── text.test.ts
├── write/
│   ├── per-region.test.ts
│   ├── stacked.test.ts
│   ├── policy.test.ts
│   └── legacy.test.ts
└── integration/
    ├── api.test.ts           # Public API + backward compat (current index.test.ts)
    └── pipeline.test.ts      # End-to-end with synthesized PDFs
```

### Design principles

| Principle | Rule |
|---|---|
| **One concern per file** | Each file does one thing. `region.ts` only clusters regions. `columns.ts` only infers columns. |
| **≤150 lines per file** | If a file exceeds 150 lines, split it. The current 580-line files would become 6–8 files of 50–100 lines each. |
| **No comment restating code** | Remove `// Sort by x` above `.sort((a,b) => a.x - b.x)`. Keep only comments explaining *why*, not *what*. |
| **No section banners** | File boundaries replace `// --------` separators. Each file's name *is* its section heading. |
| **No code duplication** | `mergeBBoxes` lives in `geometry.ts`. Tier C calls `buildPageLayout` from `extract/`, not an inline copy. |
| **Directory = concern** | `extract/` = PDF → IR. `write/` = IR → XLSX. `legacy/` = deprecated path. `types.ts` = shared types. |
| **Tests mirror source** | `tests/extract/region.test.ts` tests `src/extract/region.ts`. |

## 3. Refactoring sequence

The refactor should be done in small, testable steps. Each step must leave the test suite green.

### Step 1: Extract `geometry.ts`

Move `BBox` utilities (`mergeBBoxes`, `toTopLeftY`, `itemBBox`) from `region-discovery.ts` and `layout-engine.ts` into a shared `src/extract/geometry.ts`. Delete the duplicates. Run tests.

### Step 2: Split `region-discovery.ts` into extract modules

| Current section | New file | Lines (approx) |
|---|---|---|
| `discoverRegions`, `buildCluster` | `extract/region.ts` | ~80 |
| `clusterRows` | `extract/rows.ts` | ~45 |
| `inferColumnBoundaries`, `assignColumn` | `extract/columns.ts` | ~60 |
| `identifyTitles`, `assignOutsideText` | `extract/text.ts` | ~50 |
| `buildPageLayout`, `detectHeaders` | `extract/headers.ts` + inline in `tiers.ts` | ~70 |

Each new file imports from `geometry.ts` and `types.ts`. Run tests after each move.

### Step 3: Split `layout-engine.ts` into extract modules

| Current section | New file | Lines (approx) |
|---|---|---|
| `tryStructuredCells`, `structuredCellsToRows` | Part of `extract/tiers.ts` | ~50 |
| `tryRegionTable`, `markdownRowsToTableRows` | Part of `extract/tiers.ts` | ~40 |
| Tier C inline code | Removed (calls `buildPageLayout`) | -60 |
| `extractPageLayout` | `extract/tiers.ts` (orchestrator) | ~60 |
| `extractPdfPagesLayout`, `inferPageDimensions` | `extract/index.ts` | ~80 |

### Step 4: Split `writer.ts` into write modules

| Current section | New file | Lines (approx) |
|---|---|---|
| `writePerRegionStreaming`, `writePerRegionBuffer` | `write/per-region.ts` | ~120 |
| `writeStackedStreaming`, `writeStackedBuffer` | `write/stacked.ts` | ~100 |
| `resolvePolicy`, `headerSignature` | `write/policy.ts` | ~40 |
| `writeLegacyPages`, `pageRowsToLayout` | `write/legacy.ts` | ~60 |
| `writePagesToWorkbook` | `write/index.ts` | ~40 |

### Step 5: Move legacy modules

Move `engine.ts` → `legacy/engine.ts` and `parser.ts` → `legacy/parser.ts`. Update import paths in `pipeline.ts` (now `convert.ts`) and `index.ts`.

### Step 6: Rename `pipeline.ts` → `convert.ts`

The name "pipeline" is vague. `convert.ts` matches the exported function names (`convertPdf`, `convertPages`).

### Step 7: Strip comments

In every file:
- Remove comments that restate the next line of code.
- Remove `// ---------------------------------------------------------------------------` banners.
- Keep comments that explain *why* (e.g., "2.5× median prevents single-table columns from splitting").
- Keep JSDoc on exported functions and interfaces.

Target: code% rises from 64% to ≥85%.

### Step 8: Move and restructure tests

Reorganize `tests/` to mirror `src/`. Split `region-discovery.test.ts` (24 tests) into `extract/region.test.ts`, `extract/rows.test.ts`, `extract/columns.test.ts`, `extract/text.test.ts`. Split `writer.test.ts` (11 tests) into `write/per-region.test.ts`, `write/stacked.test.ts`, `write/policy.test.ts`. Move `index.test.ts` → `integration/api.test.ts`.

## 4. Comment policy

### Remove

```ts
// Sort items by x coordinate
const sorted = [...items].sort((a, b) => a.x - b.x);

// Filter to text items only (no images, links, form fields)
const textItems = items.filter(it => it.itemType === 'Text');

// ---------------------------------------------------------------------------
// Region discovery via x-gap clustering
// ---------------------------------------------------------------------------
```

### Keep

```ts
// 2.5× median prevents intra-table column gaps from triggering region splits,
// while still catching the inter-table gap in side-by-side layouts.
const relativeMin = medianGap * 2.5;

/** @deprecated Use the layout engine path instead. */
export function markdownToRows(markdown: string): string[][] {
```

### Rule of thumb

If deleting the comment would make a reviewer ask "why?", keep it. If deleting it changes nothing about understanding, remove it.

## 5. Estimated impact

| Metric | Current | After refactor |
|---|---:|---:|
| Files in `src/` | 8 | 17 |
| Max file length | 579 lines | ≤150 lines |
| Avg file length | 264 lines | ~75 lines |
| Total lines | 2,112 | ~1,500 (comment removal) |
| Code % | 64% | ≥85% |
| Duplicated code | 2 instances | 0 |

No functional behavior changes. All 39 tests pass before and after.
