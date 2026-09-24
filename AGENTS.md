# Agent Instructions

Read [docs/coding-practices.md](docs/coding-practices.md) for the detailed
structural and style reference. This file contains only repo-specific operating
rules for AI coding agents.

## Before changing anything

- Inspect the actual worktree, target files, tests, and relevant history.
- Check `git status` and `git log` before relying on any prior summary.
- Identify the code path that owns the behavior and state one falsifiable
  hypothesis before editing.

## While working

- Make structural fixes generalizable. Never tune production behavior to one
  PDF's values, page count, row count, or column count.
- Keep functional changes separate from refactors and cleanup. Do not mix
  them in one diff or commit.
- When a heuristic is uncertain, warn, flag, or fail explicitly. Never guess
  silently or discard extracted content.
- Verify real output files, especially XLSX content, instead of trusting only
  pipeline counters or summaries. This repository has had a data-loss bug that
  counters did not expose.
- Preserve unrelated user changes and avoid destructive Git commands.
- Create checkpoint commits during substantial work so another agent can
  recover from `git status` and `git log` without chat history.

## Before finishing

- Run the narrowest relevant validation, then `npm run build` and `npm test`
  when the change affects source behavior.
- Report residual uncertainty and the exact verification performed.
- Keep PDFs, generated XLSX files, temporary archives, and one-off reports in
  ignored `eval/`; reusable documentation belongs in `docs/` and reusable
  scripts belong in `scripts/`.
