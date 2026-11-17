/**
 * Just enough of Mermaid flowchart syntax to find which nodes a diagram defines (FMD-3): a
 * line scanner instead of a Mermaid dependency.
 */

const FENCE = /^\s*(`{3,}|~{3,})\s*(\S*)/;

/** Contents of every fenced `mermaid` block of a markdown document, in order. */
export function mermaidBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let open: { fence: string; mermaid: boolean; lines: string[] } | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const fence = FENCE.exec(line);
    if (open === null) {
      if (fence !== null) {
        const marker = fence[1] ?? '```';
        open = { fence: marker, mermaid: fence[2] === 'mermaid', lines: [] };
      }
      continue;
    }
    const closes =
      fence !== null &&
      fence[2] === '' &&
      (fence[1] ?? '').startsWith(open.fence.charAt(0)) &&
      (fence[1] ?? '').length >= open.fence.length;
    if (closes) {
      if (open.mermaid) blocks.push(open.lines.join('\n'));
      open = null;
    } else {
      open.lines.push(line);
    }
  }
  // An unclosed fence runs to the end of the document, as in CommonMark.
  if (open?.mermaid === true) blocks.push(open.lines.join('\n'));
  return blocks;
}

const IGNORED_LINE =
  /^(?:%%|(?:subgraph|end|classDef|class|style|click|linkStyle|flowchart|graph)(?![\w-]))/;

/** Shape openers, longest first, with the text that closes their label. */
const SHAPES: readonly (readonly [open: string, close: string])[] = [
  ['([', '])'],
  ['[[', ']]'],
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
  ['>', ']'],
];

const ID_CHAR = /[A-Za-z0-9_]/;

/**
 * Ids of the nodes a flowchart block defines with a label (`id[…]`, `id(…)`, `id{…}`, `id([…])`,
 * `id[[…]]`, `id>…]`), also inside edge lines, unique in order of first definition. Plain ids in
 * edges only reference nodes and are not returned; label and edge-label text is skipped.
 */
export function definedNodes(block: string): string[] {
  const nodes: string[] = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || IGNORED_LINE.test(line)) continue;
    for (const node of nodesOfLine(line)) {
      if (!nodes.includes(node)) nodes.push(node);
    }
  }
  return nodes;
}

function nodesOfLine(line: string): string[] {
  const nodes: string[] = [];
  let i = 0;
  while (i < line.length) {
    const char = line.charAt(i);
    if (char === '|') {
      // Edge label `-->|text|`: its text may contain brackets that are no nodes.
      const close = line.indexOf('|', i + 1);
      i = close === -1 ? line.length : close + 1;
      continue;
    }
    if (!ID_CHAR.test(char)) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < line.length && ID_CHAR.test(line.charAt(end))) end += 1;
    const id = line.slice(i, end);
    const shape = SHAPES.find(([open]) => line.startsWith(open, end));
    if (shape === undefined) {
      i = end;
      continue;
    }
    const [open, close] = shape;
    nodes.push(id);
    i = labelEnd(line, end + open.length, close);
  }
  return nodes;
}

/** Index just past the label that starts at `start`; a quoted label may contain the closer. */
function labelEnd(line: string, start: number, close: string): number {
  let from = start;
  const quoted = line.slice(start).match(/^\s*"/);
  if (quoted !== null) {
    const endQuote = line.indexOf('"', start + quoted[0].length);
    if (endQuote !== -1) from = endQuote + 1;
  }
  const closeAt = line.indexOf(close, from);
  return closeAt === -1 ? line.length : closeAt + close.length;
}
