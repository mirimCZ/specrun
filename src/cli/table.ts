/** Left-aligned columns separated by two spaces; shared by the read-only commands. */
export function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, col) => Math.max(...rows.map((row) => (row[col] ?? '').length)));
  return rows
    .map((row) =>
      row
        .map((cell, col) => cell.padEnd(widths?.[col] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}
