import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Config } from '../config/configSchema.js';
import { formatIssues } from '../config/loadConfig.js';
import { FeatureFrontmatterSchema, type FeatureFrontmatter } from './featureSchema.js';
import { definedNodes, mermaidBlocks } from './mermaidNodes.js';

export const FEATURE_MAP_FILE = 'README.md';

/** Something the loader couldn't parse, or a file it doesn't know what to do with. */
export interface Problem {
  /** Repo-relative, `/`-separated. */
  path: string;
  message: string;
  level: 'error' | 'warning';
}

export interface FeatureIndexRow {
  id: string;
  /** Target of the ID cell's `[id](link)`; null when the cell is no link. */
  link: string | null;
  title: string;
}

export interface FeatureMapReadme {
  path: string;
  /** Number of fenced `mermaid` blocks (FMD-2 wants exactly one). */
  mermaidBlocks: number;
  /** Nodes defined across all mermaid blocks, unique. */
  nodes: string[];
  /** Rows of the `## Features` table, header and separator excluded. */
  rows: FeatureIndexRow[];
}

export interface FeatureDoc {
  /** Repo-relative, `/`-separated: `<featuresDir>/<area>/<name>.md`. */
  path: string;
  /** `<area>/<name>`, not validated — the check compares it with the pattern and `id`. */
  idFromPath: string;
  /** null when the frontmatter is missing or invalid (a problem says why). */
  frontmatter: FeatureFrontmatter | null;
  /** `## ` headings in document order. */
  sections: string[];
  /** Top-level `- ` bullets of `## Capabilities`. */
  capabilities: number;
}

export interface FeatureMap {
  readme: FeatureMapReadme | null;
  docs: FeatureDoc[];
  problems: Problem[];
}

/**
 * Reads `<featuresDir>` into a typed model without judging it (that is `checkFeatureMap`'s job);
 * `null` when the repo has no feature map (FMD-1). Never throws on content.
 */
export function loadFeatureMap(repoRoot: string, config: Config): FeatureMap | null {
  const featuresDir = config.featuresDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = join(repoRoot, featuresDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) return null;

  const problems: Problem[] = [];
  const readmePath = join(root, FEATURE_MAP_FILE);
  const readme = existsSync(readmePath)
    ? parseReadme(`${featuresDir}/${FEATURE_MAP_FILE}`, readFileSync(readmePath, 'utf8'), problems)
    : null;

  const docs: FeatureDoc[] = [];
  for (const relative of markdownFiles(root)) {
    const path = `${featuresDir}/${relative}`;
    const parts = relative.split('/');
    if (parts.length === 1 && relative === FEATURE_MAP_FILE) continue;
    if (parts.length !== 2) {
      problems.push({
        path,
        message: 'not a feature doc: feature docs live at <featuresDir>/<area>/<name>.md',
        level: 'warning',
      });
      continue;
    }
    const idFromPath = relative.slice(0, -'.md'.length);
    docs.push(parseDoc(path, idFromPath, readFileSync(join(root, relative), 'utf8'), problems));
  }
  return { readme, docs, problems };
}

/** `.md` files under `root`, relative and `/`-separated, sorted. */
function markdownFiles(root: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...markdownFiles(root, relative));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(relative);
  }
  return files.sort();
}

function parseReadme(path: string, markdown: string, problems: Problem[]): FeatureMapReadme {
  const blocks = mermaidBlocks(markdown);
  const nodes: string[] = [];
  for (const block of blocks) {
    for (const node of definedNodes(block)) if (!nodes.includes(node)) nodes.push(node);
  }
  const table = sectionLines(markdown, 'Features');
  if (table === null) {
    problems.push({ path, message: 'no "## Features" section', level: 'error' });
  }
  return {
    path,
    mermaidBlocks: blocks.length,
    nodes,
    rows: parseRows(path, table ?? [], problems),
  };
}

const SEPARATOR_ROW = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;
const LINK_CELL = /^\[([^\]]*)\]\(([^)]*)\)$/;

function parseRows(path: string, lines: string[], problems: Problem[]): FeatureIndexRow[] {
  const rows: FeatureIndexRow[] = [];
  let headerSeen = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    if (!headerSeen) {
      headerSeen = true;
      continue;
    }
    if (SEPARATOR_ROW.test(line)) continue;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
    const [idCell, title] = cells;
    if (cells.length < 3 || idCell === undefined || title === undefined) {
      problems.push({
        path,
        message: `features row is not "ID | Title | Summary": ${line}`,
        level: 'error',
      });
      continue;
    }
    const link = LINK_CELL.exec(idCell);
    rows.push(
      link === null
        ? { id: idCell, link: null, title }
        : { id: link[1] ?? '', link: link[2] ?? '', title },
    );
  }
  return rows;
}

function parseDoc(
  path: string,
  idFromPath: string,
  markdown: string,
  problems: Problem[],
): FeatureDoc {
  const { yaml, body } = splitFrontmatter(markdown);
  let frontmatter: FeatureFrontmatter | null = null;
  if (yaml === null) {
    problems.push({ path, message: 'no YAML frontmatter (--- … ---)', level: 'error' });
  } else {
    const value = parseYaml(yaml);
    if (!value.ok) {
      problems.push({
        path,
        message: `frontmatter is not valid YAML: ${value.error}`,
        level: 'error',
      });
    } else {
      const parsed = FeatureFrontmatterSchema.safeParse(value.value);
      if (parsed.success) frontmatter = parsed.data;
      else {
        const issues = formatIssues(parsed.error).join('; ');
        problems.push({ path, message: `invalid frontmatter: ${issues}`, level: 'error' });
      }
    }
  }
  return {
    path,
    idFromPath,
    frontmatter,
    sections: headings(body),
    capabilities: (sectionLines(body, 'Capabilities') ?? []).filter((line) => line.startsWith('- '))
      .length,
  };
}

function parseYaml(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: parse(text) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.split('\n')[0] ?? message };
  }
}

function splitFrontmatter(markdown: string): { yaml: string | null; body: string } {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { yaml: null, body: markdown };
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close === -1) return { yaml: null, body: markdown };
  return { yaml: lines.slice(1, close).join('\n'), body: lines.slice(close + 1).join('\n') };
}

const FENCE = /^\s*(?:`{3,}|~{3,})/;
const H2 = /^##\s+(.+?)\s*#*\s*$/;

/** Lines outside fenced code blocks, so a `## ` or `- ` inside an example doesn't count. */
function proseLines(markdown: string): string[] {
  const lines: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence;
    else if (!inFence) lines.push(line);
  }
  return lines;
}

function headings(markdown: string): string[] {
  return proseLines(markdown).flatMap((line) => {
    const match = H2.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

/** Lines of the first `## <title>` section up to the next H1/H2; null when there is none. */
function sectionLines(markdown: string, title: string): string[] | null {
  const lines = proseLines(markdown);
  const start = lines.findIndex((line) => H2.exec(line)?.[1] === title);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}
