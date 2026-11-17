import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import { createProgram } from '../program.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), content);
}

function writeMap(opts: { node?: string } = {}): void {
  write('src/a.ts', '');
  write(
    'docs/features/README.md',
    [
      '# Features',
      '',
      '```mermaid',
      'flowchart LR',
      `  ${opts.node ?? 'board_turns'}[Turns]`,
      '```',
      '',
      '## Features',
      '',
      '| ID | Title | Summary |',
      '| --- | --- | --- |',
      '| [board/turns](board/turns.md) | Turns | s |',
      '',
    ].join('\n'),
  );
  write(
    'docs/features/board/turns.md',
    [
      '---',
      'id: board/turns',
      'title: Turns',
      'status: draft',
      'code: [src/a.ts]',
      '---',
      '## Purpose',
      'p',
      '## Capabilities',
      '- one',
      '- two',
      '- three',
      '## Expectations',
      '- e',
      '',
    ].join('\n'),
  );
}

async function check(): Promise<string> {
  const deps = captureDeps(dir);
  await createProgram(deps).parseAsync(['node', 'specrun', 'features', 'check']);
  return deps.out.join('');
}

describe('specrun features check', () => {
  it('exits 0 with the OK line for a valid map', async () => {
    writeDemoSpec(dir);
    writeMap();
    expect(await check()).toBe('feature map OK — 1 features\n');
    expect(process.exitCode).toBeUndefined();
  });

  it('exits 1 and lists path: message lines for a broken map', async () => {
    writeDemoSpec(dir);
    writeMap({ node: 'stray' });
    const out = await check();
    expect(out).toContain('docs/features/board/turns.md: feature has no node "board_turns"');
    expect(out).toContain('docs/features/README.md: mermaid node "stray" has no feature doc');
    expect(out).toContain('2 errors, 0 warnings');
    expect(process.exitCode).toBe(1);
  });

  it('prints "No feature map" without a features dir and exits 0', async () => {
    writeDemoSpec(dir);
    expect(await check()).toContain('No feature map');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports an unknown feature id in a spec tasks.yaml', async () => {
    const specDir = writeDemoSpec(dir);
    writeMap();
    writeFileSync(
      join(specDir, 'tasks.yaml'),
      stringify({
        tasks: [{ id: 'D-1', title: 'First', phase: 1, features: ['board/turns', 'no/such'] }],
      }),
    );
    const out = await check();
    expect(out).toContain('docs/demo/tasks.yaml: task D-1: unknown feature "no/such"');
    expect(process.exitCode).toBe(1);
  });
});
