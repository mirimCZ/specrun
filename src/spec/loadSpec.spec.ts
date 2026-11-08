import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigSchema, type Config } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { listSpecs, loadSpec } from './loadSpec.js';
import type { SpecTask } from './specSchema.js';

const config: Config = ConfigSchema.parse({ verify: [{ name: 'test', command: 'npm test' }] });

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'specrun-'));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function task(id: string, overrides: Partial<SpecTask> = {}): SpecTask {
  return {
    id,
    title: `Task ${id}`,
    phase: 1,
    needs: [],
    model: 'default',
    size: 'S',
    ...overrides,
  };
}

/** Writes `docs/<name>/spec.json` and a brief for every task unless listed in `withoutBrief`. */
function writeSpec(name: string, tasks: SpecTask[], withoutBrief: string[] = []): string {
  const dir = join(repo, 'docs', name);
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ title: 'Demo', tasks }));
  for (const { id } of tasks) {
    if (!withoutBrief.includes(id)) writeFileSync(join(dir, 'tasks', `${id}.md`), `# ${id}\n`);
  }
  return dir;
}

function loadError(name: string): SpecrunError {
  try {
    loadSpec(repo, config, name);
  } catch (error) {
    if (error instanceof SpecrunError) return error;
    throw error;
  }
  throw new Error('loadSpec did not throw');
}

describe('loadSpec', () => {
  it('loads a valid spec', () => {
    const dir = writeSpec('v1', [task('A-1'), task('A-2', { phase: 2, needs: ['A-1'] })]);
    const loaded = loadSpec(repo, config, 'v1');
    expect(loaded.name).toBe('v1');
    expect(loaded.dir).toBe(dir);
    expect(loaded.spec.tasks.map((t) => t.id)).toEqual(['A-1', 'A-2']);
    expect(loaded.briefPath('A-2')).toBe(join(dir, 'tasks', 'A-2.md'));
    expect(loaded.taskPromptPath).toBeNull();
  });

  it('finds TASK_PROMPT.md in the spec dir', () => {
    const dir = writeSpec('v1', [task('A-1')]);
    writeFileSync(join(dir, 'TASK_PROMPT.md'), 'prompt');
    expect(loadSpec(repo, config, 'v1').taskPromptPath).toBe(join(dir, 'TASK_PROMPT.md'));
  });

  it('fails with spec-missing without spec.json', () => {
    expect(loadError('nope').code).toBe('spec-missing');
  });

  it('reports schema issues with their path', () => {
    writeSpec('v1', [task('a-1'), task('A-2', { phase: 0 })]);
    const error = loadError('v1');
    expect(error.code).toBe('spec-invalid');
    expect(error.details).toEqual([
      expect.stringMatching(/^tasks\.0\.id: /),
      expect.stringMatching(/^tasks\.1\.phase: /),
    ]);
  });

  const needs = (...ids: string[]): Partial<SpecTask> => ({ needs: ids });

  it.each<{ name: string; tasks: SpecTask[]; withoutBrief?: string[]; problem: string }>([
    {
      name: 'a duplicate id',
      tasks: [task('A-1'), task('A-1')],
      problem: 'duplicate task id A-1',
    },
    {
      name: 'an unknown need',
      tasks: [task('A-1', needs('A-9'))],
      problem: 'A-1 needs unknown task A-9',
    },
    {
      name: 'a self-dependency',
      tasks: [task('A-1', needs('A-1'))],
      problem: 'A-1 needs itself',
    },
    {
      name: 'a dependency on a later phase',
      tasks: [task('A-1', needs('A-2')), task('A-2', { phase: 2 })],
      problem: 'A-1 needs A-2 of a later phase (phase 1 → 2)',
    },
    {
      name: 'a cycle',
      tasks: [task('A-1', needs('A-3')), task('A-2', needs('A-1')), task('A-3', needs('A-2'))],
      problem: 'dependency cycle: A-1 → A-3 → A-2 → A-1',
    },
    {
      name: 'a missing brief',
      tasks: [task('A-1')],
      withoutBrief: ['A-1'],
      problem: 'A-1 has no brief: tasks/A-1.md is missing',
    },
  ])('reports $name', ({ tasks, withoutBrief = [], problem }) => {
    writeSpec('v1', tasks, withoutBrief);
    const error = loadError('v1');
    expect(error.code).toBe('spec-invalid');
    expect(error.details).toEqual([problem]);
    expect(error.message).toContain(problem);
  });

  it('lists several problems at once', () => {
    writeSpec(
      'v1',
      [
        task('A-1', { needs: ['A-2', 'B-1'] }),
        task('A-2', { needs: ['A-1'] }),
        task('A-2'),
        task('A-3', { phase: 2 }),
      ],
      ['A-3'],
    );
    expect(loadError('v1').details).toEqual([
      'duplicate task id A-2',
      'A-1 needs unknown task B-1',
      'dependency cycle: A-1 → A-2 → A-1',
      'A-3 has no brief: tasks/A-3.md is missing',
    ]);
  });
});

describe('listSpecs', () => {
  it('lists folders with a spec.json, ignoring the others', () => {
    writeSpec('v2', [task('A-1')]);
    writeSpec('v1', [task('A-1')]);
    mkdirSync(join(repo, 'docs', 'notes'));
    writeFileSync(join(repo, 'docs', 'README.md'), '');
    expect(listSpecs(repo, config)).toEqual(['v1', 'v2']);
  });

  it('returns nothing when specsDir does not exist', () => {
    expect(listSpecs(repo, config)).toEqual([]);
  });
});
