# Coding Practices

This guide describes the engineering practices for Reamify and for agents
making changes in the repository. It is intentionally independent of any one
PDF, benchmark run, or refactoring milestone.

## Start with the owning code path

Before changing code:

1. Identify the public API, failing test, or user-visible behavior involved.
2. Follow the call path to the function that actually computes or mutates the
   behavior.
3. Read nearby tests and types before choosing an implementation.
4. Form one concrete hypothesis about the behavior and one check that could
   disprove it.

Prefer the smallest change that tests the hypothesis. Do not broaden the
change merely to make nearby code look more consistent.

## Repository boundaries

Keep responsibilities aligned with the existing directories:

- `src/extract/` converts PDF layout information into the internal table
  representation.
- `src/write/` converts extracted pages into XLSX workbooks.
- `src/legacy/` contains the deprecated markdown-based compatibility path.
- `src/types.ts` contains shared public and intermediate-representation types.
- `tests/` mirrors the extraction, writing, and integration boundaries.
- `docs/` contains durable project documentation.
- `scripts/` contains reusable diagnostics and development utilities.
- `eval/` is for local, document-specific investigations and generated
  artifacts. It is intentionally not part of the published package.

Keep the public barrel and public types deliberate. Preserve existing exports
and compatibility behavior unless a change explicitly requires an API change.

## Design principles

### One responsibility per module

Keep extraction, layout modeling, post-processing, and workbook writing
separate. Add a module when it creates a clear ownership boundary, not merely
to reduce a line count.

### Prefer structural signals

PDF text placement is not a reliable proxy for logical columns. Use bounding
boxes, row geometry, headers, region structure, and explicit metadata when
available. Do not infer record boundaries by splitting cell text on spaces.

### Generalize from document structure

Production logic must work across different page sizes, column counts, region
layouts, and text widths. Never encode a PDF's page number, names, row count,
or observed value pattern as a production rule.

### Make uncertainty visible

When structure cannot be resolved confidently, preserve the source information
where possible and emit a warning or diagnostic. Do not silently discard a
region, row, cell, or non-table text.

### Keep streaming boundaries honest

The Node writing path supports streaming output, but upstream extraction and
post-processing must also be considered when evaluating memory behavior. Do
not describe a path as fully streaming unless its intermediate state is
bounded as well.

### Avoid duplicate representations

Prefer the richest available structured representation. Do not convert
position-aware or structured cells to markdown and then reconstruct their
meaning from strings unless the conversion is an intentional compatibility
fallback.

## Comments and naming

- Use names that describe the domain operation, not an implementation accident.
- Keep comments that explain why a threshold, ordering, fallback, or
  compatibility branch exists.
- Remove comments that merely repeat the next line of code.
- Avoid section banners and speculative comments about future work.
- Keep JSDoc on exported APIs when it explains behavior, options, units, or
  compatibility guarantees.

## Tests and verification

Every behavior change should have a focused test at the owning boundary.
Extend integration coverage when a change crosses extraction and writing.

Include cases that exercise the general rule, not only the document that
motivated the change. For layout work, vary region count, column alignment,
header repetition, multi-line headers, text containing spaces, and ambiguous
or missing structure.

Verify the produced XLSX when the change affects output. Check actual rows,
headers, column counts, warnings, and preserved values rather than relying
only on internal counters.

Run the repository checks before submitting a change:

```bash
npm run build
npm test
```

For performance changes, measure extraction, processing, and writing
separately. Record the input shape and runtime environment instead of making
general performance claims from one unqualified run.

## Change and review hygiene

- Keep functional changes separate from unrelated cleanup.
- Preserve user changes already present in the worktree.
- Keep public APIs and generated output stable unless the task requires a
  deliberate change.
- Do not commit PDFs, generated XLSX files, temporary archives, or private
  investigation reports.
- Keep reusable scripts parameterized and place them under `scripts/`.
- Use small commits with messages that explain one logical change.
- Describe what was verified and call out unresolved limitations.

## Completion checklist

- The owning implementation and nearby tests were inspected.
- The change is general rather than document-specific.
- Ambiguous or dropped data has an explicit policy.
- Focused tests cover the changed behavior.
- `npm run build` and `npm test` pass.
- Documentation and public API comments match the implementation.
- Generated and local-only artifacts remain excluded.
