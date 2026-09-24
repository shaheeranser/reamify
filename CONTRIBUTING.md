# Contributing to Reamify

Reamify handles PDF layouts that produce incorrect table structure in naive converters. Contributions that reproduce a general layout problem are especially useful.

## Getting started

```bash
git clone https://github.com/shaheeranser/reamify.git
cd reamify
npm install
npm run build
npm test
```

## Project conventions

- Keep functional changes separate from structural or comment-only cleanup.
- Make fixes generalizable; do not rely on a hardcoded document, page count, or column count.
- When a heuristic cannot resolve a case confidently, report or flag it rather than guessing silently.
- Verify produced XLSX content directly when investigating extraction or writing behavior; internal counters alone are not sufficient.
- Keep tests aligned with the source areas they cover under `tests/`.

## Reporting bugs

Include the PDF or a synthetic reproduction, affected page numbers, and expected versus actual output. Avoid committing confidential PDFs or generated workbooks; describe how maintainers can obtain them privately instead.

## Performance work

Profile before changing a hot path and identify whether time is spent in native PDF extraction, Reamify processing, or XLSX writing. Reusable diagnostic scripts belong under `scripts/`; document-specific reports and generated artifacts belong in the local `eval/` workspace.

## Pull requests

1. Open an issue first for non-trivial changes.
2. Add or update tests for behavior changes.
3. Run `npm run build && npm test`.
4. Describe the verification performed and any known limitations.

Use small, focused commits with messages that explain the change to a reader of the public history.

## Code of conduct

Be respectful, assume good faith, and keep technical discussion focused on improving the project.