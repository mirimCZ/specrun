import { posix } from 'node:path';

// Files every task reads anyway; listing them as "extra" or "unread" would be noise.
export const COMMON_FILES: readonly string[] = ['CLAUDE.md', 'docs/testing.md'];

const FILE_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sh|yml|yaml|toml|css|html|txt)$/;
const LINE_HINT = /:\d+(?:-\d+)?$/;
const BRACES = /\{([^{}]*,[^{}]*)\}/;

export function looksLikePath(token: string): boolean {
  if (/[\s<>*]/.test(token) || token.startsWith('http')) return false;
  return token.includes('/') || FILE_EXTENSION.test(token);
}

/** `locales/{cs,en}/common.json` → one path per alternative. */
function expandBraces(token: string): string[] {
  const match = BRACES.exec(token);
  if (match === null) return [token];
  const [group, alternatives = ''] = match;
  return alternatives.split(',').flatMap((alt) => expandBraces(token.replace(group, alt)));
}

/**
 * Briefs shorten paths after the first one of a bullet: `` `a/Foo.tsx` + `.spec.tsx` `` is
 * `a/Foo.spec.tsx`, `` `a/Foo.tsx`, `Bar.tsx` `` is `a/Bar.tsx` and
 * `` `docs/features/board/a.md`, `board/b.md`, `rooms/c.md` `` stay under `docs/features/`.
 */
function siblingResolver(): (token: string) => string {
  let previous: string | null = null;
  let root: string | null = null;
  return (token) => {
    let path = token;
    if (previous !== null) {
      const dir = posix.dirname(previous);
      if (!token.includes('/')) {
        const stem = posix.basename(previous).split('.')[0] ?? '';
        path = posix.join(dir, token.startsWith('.') ? `${stem}${token}` : token);
      } else {
        const dirs = dir.split('/');
        const at = dirs.lastIndexOf(token.split('/')[0] ?? '');
        if (at >= 0) root = dirs.slice(0, at).join('/');
        path = root === null ? token : posix.join(root, token);
      }
    }
    if (path.includes('/')) previous = path;
    return path;
  };
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Bullets of a section, each with its continuation lines and nested bullets joined. */
function bulletItems(lines: readonly string[]): string[] {
  const items: string[] = [];
  let indent: number | null = null;
  for (const line of lines) {
    const nested = indent !== null && indentOf(line) > indent && /\S/.test(line);
    if (/^\s*[-*]\s/.test(line) && !nested) {
      items.push(line);
      indent = indentOf(line);
    } else if (nested) {
      items[items.length - 1] += ` ${line.trim()}`;
    } else {
      indent = null;
    }
  }
  return items;
}

/** Paths in the backticked tokens of the brief's `## Read first` section, without common files. */
export function parseReadFirst(briefMarkdown: string): string[] {
  const lines = briefMarkdown.split('\n');
  const start = lines.findIndex((line) => /^##\s+Read first\s*$/i.test(line));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const paths: string[] = [];
  for (const item of bulletItems(end === -1 ? rest : rest.slice(0, end))) {
    const resolve = siblingResolver();
    for (const match of item.matchAll(/`([^`]+)`/g)) {
      const token = (match[1] ?? '').trim().replace(LINE_HINT, '');
      if (!looksLikePath(token) || COMMON_FILES.includes(token)) continue;
      for (const expanded of expandBraces(token)) {
        const path = resolve(expanded);
        if (!COMMON_FILES.includes(path) && !paths.includes(path)) paths.push(path);
      }
    }
  }
  return paths;
}
