/**
 * @deprecated Use `markdownToRows` only as a legacy fallback.
 * The layout engine extracts structured cells directly from positioned
 * text and table-region APIs, bypassing markdown entirely.
 *
 * See eval/root-cause-analysis.md §R2: this function accepts only
 * pipe-delimited lines, dropping headings and trailing text.
 */
export function markdownToRows(markdown: string): string[][] {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));
  const rows: string[][] = [];

  for (const line of lines) {
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim().replaceAll('\\|', '|'));
    if (cells.length > 0 && !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      rows.push(cells);
    }
  }

  return rows;
}