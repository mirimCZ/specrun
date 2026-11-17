import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema, type Config } from '../config/configSchema.js';
import { loadFeatureMap } from './loadFeatureMap.js';

const config: Config = ConfigSchema.parse({ verify: [{ name: 'test', command: 'npm test' }] });

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'specrun-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const path = join(repo, 'specrun', 'features', relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const README = [
  '# Feature map',
  '',
  'What the app does.',
  '',
  '```mermaid',
  'flowchart TD',
  '  subgraph board [Board]',
  '    board_fog_cells[Fog cells] --> board_turns([Turns])',
  '  end',
  '```',
  '',
  '## Features',
  '',
  '| ID | Title | Summary |',
  '| --- | --- | --- |',
  '| [board/fog-cells](board/fog-cells.md) | Fog cells | Hidden cells. |',
  '| [board/turns](board/turns.md) | Turns | Turn order. |',
  '',
].join('\n');

function doc(id: string, options: { capabilities?: number; frontmatter?: string } = {}): string {
  const frontmatter =
    options.frontmatter ??
    [`id: ${id}`, `title: ${id}`, 'status: draft', 'code:', '  - src/board'].join('\n');
  const bullets = Array.from({ length: options.capabilities ?? 3 }, (_, i) => `- Can ${i}`);
  return [
    '---',
    frontmatter,
    '---',
    `# ${id}`,
    '',
    '## Purpose',
    '',
    'Why.',
    '',
    '## Capabilities',
    '',
    ...bullets,
    '  - nested, not counted',
    '',
    '```md',
    '- in a fence, not counted',
    '## Not a section',
    '```',
    '',
    '## Expectations',
    '',
    '- Not a capability',
    '',
    '## Pitfalls',
    '',
    'Some.',
    '',
  ].join('\n');
}

describe('loadFeatureMap', () => {
  it('returns null when featuresDir does not exist', () => {
    expect(loadFeatureMap(repo, config)).toBeNull();
  });

  it('loads rows, nodes, docs, sections and capability counts of a valid map', () => {
    write('README.md', README);
    write('board/fog-cells.md', doc('board/fog-cells', { capabilities: 4 }));
    write('board/turns.md', doc('board/turns'));

    const map = loadFeatureMap(repo, config);

    expect(map?.problems).toEqual([]);
    expect(map?.readme).toEqual({
      path: 'specrun/features/README.md',
      mermaidBlocks: 1,
      nodes: ['board_fog_cells', 'board_turns'],
      rows: [
        { id: 'board/fog-cells', link: 'board/fog-cells.md', title: 'Fog cells' },
        { id: 'board/turns', link: 'board/turns.md', title: 'Turns' },
      ],
    });
    expect(map?.docs).toEqual([
      {
        path: 'specrun/features/board/fog-cells.md',
        idFromPath: 'board/fog-cells',
        frontmatter: {
          id: 'board/fog-cells',
          title: 'board/fog-cells',
          status: 'draft',
          depends_on: [],
          code: ['src/board'],
          tests: [],
          specs: [],
        },
        sections: ['Purpose', 'Capabilities', 'Expectations', 'Pitfalls'],
        capabilities: 4,
      },
      expect.objectContaining({ idFromPath: 'board/turns', capabilities: 3 }),
    ]);
  });

  it('honours a custom featuresDir', () => {
    mkdirSync(join(repo, 'spec', 'map', 'ui'), { recursive: true });
    writeFileSync(join(repo, 'spec', 'map', 'ui', 'menu.md'), doc('ui/menu'));
    const map = loadFeatureMap(repo, { ...config, featuresDir: 'spec/map' });
    expect(map?.docs.map((d) => d.path)).toEqual(['spec/map/ui/menu.md']);
  });

  it('gives readme null when the README is missing', () => {
    write('board/turns.md', doc('board/turns'));
    const map = loadFeatureMap(repo, config);
    expect(map?.readme).toBeNull();
    expect(map?.docs).toHaveLength(1);
  });

  it('counts every mermaid block and reports a README without a Features section', () => {
    write('README.md', '# Map\n\n```mermaid\nflowchart TD\na[A]\n```\n\n```mermaid\nb[B]\n```\n');
    const map = loadFeatureMap(repo, config);
    expect(map?.readme).toMatchObject({ mermaidBlocks: 2, nodes: ['a', 'b'], rows: [] });
    expect(map?.problems).toEqual([
      { path: 'specrun/features/README.md', message: 'no "## Features" section', level: 'error' },
    ]);
  });

  it('keeps an ID cell that is no link with link null', () => {
    write(
      'README.md',
      '# Map\n\n## Features\n\n| ID | Title | Summary |\n|-|-|-|\n| a/b | B | - |\n',
    );
    expect(loadFeatureMap(repo, config)?.readme?.rows).toEqual([
      { id: 'a/b', link: null, title: 'B' },
    ]);
  });

  it('reports broken YAML frontmatter as an error with the doc path', () => {
    write('board/turns.md', doc('board/turns', { frontmatter: 'id: [unclosed' }));
    const map = loadFeatureMap(repo, config);
    expect(map?.docs[0]?.frontmatter).toBeNull();
    expect(map?.docs[0]?.sections).toContain('Capabilities');
    expect(map?.problems).toEqual([
      {
        path: 'specrun/features/board/turns.md',
        message: expect.stringMatching(/^frontmatter is not valid YAML/) as unknown,
        level: 'error',
      },
    ]);
  });

  it('reports a schema violation as an error with the doc path', () => {
    const frontmatter = 'id: board/turns\ntitle: Turns\nstatus: done\ncode: []\nowner: me';
    write('board/turns.md', doc('board/turns', { frontmatter }));
    const map = loadFeatureMap(repo, config);
    expect(map?.docs[0]?.frontmatter).toBeNull();
    expect(map?.problems).toHaveLength(1);
    expect(map?.problems[0]).toMatchObject({
      path: 'specrun/features/board/turns.md',
      level: 'error',
    });
    expect(map?.problems[0]?.message).toMatch(/^invalid frontmatter: .*status.*code/);
  });

  it('reports a doc without frontmatter', () => {
    write('board/turns.md', '# Turns\n\n## Purpose\n');
    expect(loadFeatureMap(repo, config)?.problems).toEqual([
      expect.objectContaining({ path: 'specrun/features/board/turns.md', level: 'error' }),
    ]);
  });

  it('finds docs recursively as <area>/<name>.md and reports other depths', () => {
    write('README.md', README);
    write('board/turns.md', doc('board/turns'));
    write('ui/menu.md', doc('ui/menu'));
    write('notes.md', '# Notes\n');
    write('board/deep/cells.md', doc('board/cells'));
    write('board/cells.txt', 'not markdown');

    const map = loadFeatureMap(repo, config);

    expect(map?.docs.map((d) => d.idFromPath)).toEqual(['board/turns', 'ui/menu']);
    expect(map?.problems.map((p) => [p.path, p.level])).toEqual([
      ['specrun/features/board/deep/cells.md', 'warning'],
      ['specrun/features/notes.md', 'warning'],
    ]);
  });
});
