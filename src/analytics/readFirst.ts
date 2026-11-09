// Files every task reads anyway; listing them as "extra" or "unread" would be noise.
export const COMMON_FILES: readonly string[] = ['CLAUDE.md', 'docs/testing.md'];

const FILE_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sh|yml|yaml|toml|css|html|txt)$/;
const LINE_HINT = /:\d+(?:-\d+)?$/;

function looksLikePath(token: string): boolean {
  if (/[\s<>*]/.test(token) || token.startsWith('http')) return false;
  return token.includes('/') || FILE_EXTENSION.test(token);
}

/** Paths in the backticked tokens of the brief's `## Read first` section, without common files. */
export function parseReadFirst(briefMarkdown: string): string[] {
  const lines = briefMarkdown.split('\n');
  const start = lines.findIndex((line) => /^##\s+Read first\s*$/i.test(line));
  if (start === -1) return [];
  const paths: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!/^\s*[-*]\s/.test(line)) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const token = (match[1] ?? '').trim().replace(LINE_HINT, '');
      if (looksLikePath(token) && !COMMON_FILES.includes(token) && !paths.includes(token)) {
        paths.push(token);
      }
    }
  }
  return paths;
}
