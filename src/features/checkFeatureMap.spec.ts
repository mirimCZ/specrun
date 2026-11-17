import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema } from '../config/configSchema.js';
import { checkFeatureMap, type CheckFeatureMapInput } from './checkFeatureMap.js';
import type { FeatureDoc, FeatureMap } from './loadFeatureMap.js';

const config = ConfigSchema.parse({ verify: [{ name: 't', command: 'true' }] });
let repoRoot: string;
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'specrun-'));
  mkdirSync(join(repoRoot, 'src'));
  writeFileSync(join(repoRoot, 'src', 'a.ts'), '');
  writeFileSync(join(repoRoot, 'src', 'a.spec.ts'), '');
});
afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

function doc(id: string, overrides: Partial<FeatureDoc> = {}): FeatureDoc {
  return {
    path: `specrun/features/${id}.md`,
    idFromPath: id,
    frontmatter: {
      id,
      title: id,
      status: 'draft',
      depends_on: [],
      code: ['src/a.ts'],
      tests: ['src/a.spec.ts'],
      specs: [],
    },
    sections: ['Purpose', 'Capabilities', 'Expectations'],
    capabilities: 4,
    ...overrides,
  };
}

function validMap(): FeatureMap {
  return {
    readme: {
      path: 'specrun/features/README.md',
      mermaidBlocks: 1,
      nodes: ['board_turns'],
      rows: [{ id: 'board/turns', link: 'board/turns.md', title: 'Turns' }],
    },
    docs: [doc('board/turns')],
    problems: [],
  };
}

function check(map: FeatureMap, extra: Partial<CheckFeatureMapInput> = {}) {
  return checkFeatureMap(map, {
    repoRoot,
    config,
    specTaskFeatures: [],
    knownSpecs: [],
    ...extra,
  });
}

function messages(map: FeatureMap, extra: Partial<CheckFeatureMapInput> = {}): string[] {
  return check(map, extra).map((p) => `${p.level}|${p.path}|${p.message}`);
}

describe('checkFeatureMap', () => {
  it('accepts a fully valid map', () => {
    expect(check(validMap())).toEqual([]);
  });

  it('errors when the README is missing', () => {
    const map = { ...validMap(), readme: null };
    expect(messages(map)).toEqual([
      'error|specrun/features/README.md|feature map README is missing',
    ]);
  });

  it('errors unless there is exactly one mermaid block', () => {
    for (const count of [0, 2]) {
      const map = validMap();
      if (map.readme) map.readme.mermaidBlocks = count;
      expect(messages(map)[0]).toContain('exactly one mermaid block');
    }
  });

  it('errors on id ≠ path', () => {
    const map = validMap();
    const d = map.docs[0];
    if (d?.frontmatter) d.frontmatter.id = 'board/other';
    expect(messages(map).join('\n')).toContain('does not match the path');
  });

  it('errors on a missing required section', () => {
    const map = validMap();
    map.docs = [doc('board/turns', { sections: ['Purpose', 'Capabilities'] })];
    expect(messages(map)).toEqual([
      'error|specrun/features/board/turns.md|missing section "## Expectations"',
    ]);
  });

  it('errors on index row without doc and doc without row', () => {
    const map = validMap();
    if (map.readme) {
      map.readme.rows = [{ id: 'board/ghost', link: null, title: 'Ghost' }];
    }
    const out = messages(map);
    expect(out).toContain(
      'error|specrun/features/README.md|index row "board/ghost" has no feature doc',
    );
    expect(out).toContain(
      'error|specrun/features/board/turns.md|feature "board/turns" has no row in the index',
    );
  });

  it('errors on feature without node and node without feature', () => {
    const map = validMap();
    if (map.readme) map.readme.nodes = ['stray'];
    const out = messages(map);
    expect(out.join('\n')).toContain('no node "board_turns"');
    expect(out.join('\n')).toContain('mermaid node "stray" has no feature doc');
  });

  it('errors on node id collisions', () => {
    const map = validMap();
    map.docs = [doc('a/b-c'), doc('a-b/c')];
    map.readme = {
      path: 'specrun/features/README.md',
      mermaidBlocks: 1,
      nodes: ['a_b_c'],
      rows: [
        { id: 'a/b-c', link: null, title: '' },
        { id: 'a-b/c', link: null, title: '' },
      ],
    };
    expect(messages(map).join('\n')).toContain('collides with feature "a/b-c"');
  });

  it('errors on unknown depends_on', () => {
    const map = validMap();
    const fm = map.docs[0]?.frontmatter;
    if (fm) fm.depends_on = ['x/y'];
    expect(messages(map)).toEqual([
      'error|specrun/features/board/turns.md|depends_on: unknown feature "x/y"',
    ]);
  });

  it('errors on missing code and tests paths', () => {
    const map = validMap();
    const fm = map.docs[0]?.frontmatter;
    if (fm) {
      fm.code = ['src/gone.ts'];
      fm.tests = ['src/gone.spec.ts'];
    }
    expect(messages(map)).toEqual([
      'error|specrun/features/board/turns.md|code: "src/gone.ts" does not exist',
      'error|specrun/features/board/turns.md|tests: "src/gone.spec.ts" does not exist',
    ]);
  });

  it('errors on unknown feature ids in an active spec', () => {
    const out = messages(validMap(), {
      specTaskFeatures: [{ spec: 'v1', task: 'V-1', features: ['board/turns', 'nope/x'] }],
    });
    expect(out).toEqual(['error|specrun/specs/v1/tasks.yaml|task V-1: unknown feature "nope/x"']);
  });

  it('warns on capabilities outside 3–10', () => {
    for (const n of [2, 11]) {
      const map = validMap();
      map.docs = [doc('board/turns', { capabilities: n })];
      expect(check(map).map((p) => p.level)).toEqual(['warning']);
    }
  });

  it('warns on a specs entry that is not a known spec', () => {
    const map = validMap();
    const fm = map.docs[0]?.frontmatter;
    if (fm) fm.specs = ['001-old', '002-gone'];
    expect(messages(map, { knownSpecs: ['001-old'] })).toEqual([
      'warning|specrun/features/board/turns.md|specs: "002-gone" not found under specrun/specs/ or its archive',
    ]);
  });
});
