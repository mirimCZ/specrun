import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Appends `line` unless the file already has it; true when the file changed. */
export function ensureLine(file: string, line: string): boolean {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((existing) => existing.trim() === line)) return false;
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${current}${separator}${line}\n`);
  return true;
}
