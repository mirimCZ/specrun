import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventLine, makeTempRepo, writeDemoSpec } from '../../test/fixtures/specRepo.js';
import { doneTask } from '../../test/fixtures/taskEvents.js';
import { ConfigSchema } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { runCommand } from '../process/run.js';
import { archiveSpec, type ArchiveDeps, type ArchiveResult } from './archiveSpec.js';
import { readArchivedHistories } from './history.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8' });

const config = ConfigSchema.parse({ verify: [{ name: 'ok', command: 'true' }] });

let repo: string;
let specDir: string;

beforeEach(() => {
  repo = makeTempRepo();
  rmSync(join(repo, '.git'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  specDir = writeDemoSpec(repo);
  writeFileSync(join(specDir, 'README.md'), '# Demo\n\nWhat it does.\n\n## 3. Decision log\n');
  writeFileSync(join(specDir, 'TASK_PROMPT.md'), 'Rules.\n');
  writeFileSync(join(repo, 'other.txt'), 'one\n');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

function commitAll(message = 'spec'): void {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
}

function writeEvents(...lines: string[]): void {
  writeFileSync(join(specDir, 'events.jsonl'), lines.join(''));
}

const AMBIGUITY = {
  kind: 'ambiguity',
  what: 'kept the alias',
  why: 'simplest',
  question: { text: 'Keep the alias?', options: ['keep', 'drop'], chosen: 'keep' },
};

function completed(task: string, deviations: unknown[] = []): string {
  return eventLine({
    t: 'task.completed',
    task,
    sessionId: null,
    payload: { summary: 's', commitMessage: 'm', notes: [], deviations },
  });
}

function bothDone(): void {
  writeEvents(doneTask('D-1', 10, 0.3, completed('D-1', [AMBIGUITY])), doneTask('D-2', 20, 0.9));
}

function deps(overrides: Partial<ArchiveDeps> = {}): ArchiveDeps {
  return {
    repoRoot: repo,
    config,
    run: (cmd, args, opts) => runCommand(cmd, args, { ...opts, env }),
    now: () => new Date('2026-11-13T10:00:00.000Z'),
    isAlive: () => false,
    ...overrides,
  };
}

async function archive(
  force = false,
  overrides: Partial<ArchiveDeps> = {},
): Promise<ArchiveResult> {
  return archiveSpec({ spec: 'demo', force }, deps(overrides));
}

async function archiveError(force = false): Promise<SpecrunError> {
  const error: unknown = await archive(force).catch((e: unknown) => e);
  if (error instanceof SpecrunError) return error;
  throw new Error(`expected a SpecrunError, got ${String(error)}`);
}

describe('archiveSpec', () => {
  it('replaces the spec folder by README + history and commits only those paths', async () => {
    bothDone();
    commitAll();
    const base = git(repo, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'other.txt'), 'unrelated work in progress\n');

    const result = await archive();

    expect(result).toMatchObject({
      archiveDir: 'docs/archive/demo',
      baseCommit: base,
      history: { samples: 2, deviations: 1 },
      removed: null,
      forced: [],
    });
    expect(existsSync(specDir)).toBe(false);
    expect(readFileSync(join(repo, 'docs/archive/demo/README.md'), 'utf8')).toBe(
      [
        '# Demo',
        '',
        `> Archived on 2026-11-13 by \`specrun archive\`. The full spec folder (briefs, prompts, run log) is in git at \`${base.slice(0, 7)}\`: \`git ls-tree -r --name-only ${base.slice(0, 7)} -- docs/demo\`.`,
        '',
        'What it does.',
        '',
        '## 3. Decision log',
        '',
      ].join('\n'),
    );
    expect(readFileSync(join(repo, '.ignore'), 'utf8')).toBe('docs/archive/\n');
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('docs(demo): archive spec\n');
    expect(result.commit).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    expect(git(repo, 'status', '--porcelain').trim()).toBe('M other.txt');

    const [history] = readArchivedHistories(repo, config);
    expect(history).toMatchObject({ spec: 'demo', title: 'Demo', commit: base });
    expect(history?.samples.map((s) => [s.task, s.turns, s.size])).toEqual([
      ['D-1', 10, 'S'],
      ['D-2', 20, 'M'],
    ]);
    expect(history?.deviations).toEqual([
      {
        spec: 'demo',
        task: 'D-1',
        kind: 'ambiguity',
        decision: null,
        what: 'kept the alias',
        why: 'simplest',
        question: AMBIGUITY.question,
        reviewed: false,
      },
    ]);
  });

  it('counts status: done of a spec-run.sh spec and keeps no empty history', async () => {
    rmSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(
      join(specDir, 'tasks.yaml'),
      [
        'tasks:',
        '  - { id: D-1, phase: 1, title: First, status: done }',
        '  - { id: D-2, phase: 1, title: Second, status: done, model: opus }',
        '',
      ].join('\n'),
    );
    commitAll();

    const result = await archive();

    expect(result.history).toBeNull();
    expect(existsSync(join(repo, 'docs/archive/demo/history.json'))).toBe(false);
    expect(existsSync(join(repo, 'docs/archive/demo/README.md'))).toBe(true);
  });

  it('keeps planning totals in history.json even without samples', async () => {
    rmSync(join(specDir, 'tasks'), { recursive: true });
    writeFileSync(
      join(specDir, 'tasks.yaml'),
      'tasks:\n  - { id: D-1, phase: 1, title: First, status: done }\n',
    );
    writeFileSync(
      join(specDir, 'events.jsonl'),
      eventLine({
        t: 'plan.session',
        sessionId: 's1',
        resumed: false,
        exitCode: 0,
        metrics: {
          turns: 5,
          inputTokens: 100,
          outputTokens: 50,
          cacheRead: 1000,
          cacheWrite: 10,
          peakContext: 7000,
          models: ['m'],
          subagents: {
            files: 1,
            turns: 2,
            inputTokens: 1,
            outputTokens: 2,
            cacheRead: 3,
            cacheWrite: 4,
          },
        },
      }),
    );
    commitAll();

    await archive();

    const [history] = readArchivedHistories(repo, config);
    expect(history?.planning).toMatchObject({ sessions: 1, turns: 5, subagentTokens: 10 });
    expect(history?.samples).toEqual([]);
  });

  it('parses a history file without planning as null', () => {
    const dir = join(repo, 'docs/archive/old');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'history.json'),
      JSON.stringify({
        version: 1,
        spec: 'old',
        title: 'Old',
        archivedAt: '2026-01-01T09:00:00.000Z',
        commit: 'abc',
        samples: [],
        deviations: [],
      }),
    );
    expect(readArchivedHistories(repo, config)[0]?.planning).toBeNull();
  });

  it('refuses unfinished tasks unless forced', async () => {
    writeEvents(doneTask('D-1', 10, 0.3));
    commitAll();

    const error = await archiveError();
    expect(error.details).toEqual(['D-2 (todo)', 'archive with --force to archive it anyway']);
    expect(existsSync(specDir)).toBe(true);

    const result = await archive(true);
    expect(result.forced).toEqual(['D-2 (todo)']);
    expect(result.history).toEqual({ samples: 1, deviations: 0 });
  });

  it('archives a spec without tasks.yaml only when forced, keeping the README', async () => {
    rmSync(join(specDir, 'tasks.yaml'));
    commitAll();

    expect((await archiveError()).details).toEqual([
      'tasks.yaml is missing',
      'archive with --force to keep only the README',
    ]);
    const result = await archive(true);
    expect(result).toMatchObject({ history: null, forced: [] });
  });

  it('writes a README stub when the spec has none', async () => {
    bothDone();
    rmSync(join(specDir, 'README.md'));
    commitAll();

    await archive();

    const readme = readFileSync(join(repo, 'docs/archive/demo/README.md'), 'utf8');
    expect(readme).toMatch(/^# Demo\n\n> Archived on 2026-11-13/);
  });

  it('refuses uncommitted changes in the spec folder', async () => {
    bothDone();
    commitAll();
    writeFileSync(join(specDir, 'notes.md'), 'untracked\n');

    expect((await archiveError(true)).summary).toBe('docs/demo has uncommitted changes');
    expect(existsSync(join(specDir, 'notes.md'))).toBe(true);
  });

  it('refuses while a run holds the lock', async () => {
    bothDone();
    commitAll();
    mkdirSync(join(repo, '.specrun', 'locks'), { recursive: true });
    writeFileSync(join(repo, '.specrun', 'locks', 'demo.lock'), '4242');

    const error: unknown = await archive(true, { isAlive: () => true }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'locked' });
  });

  it('refuses a spec that is already archived', async () => {
    bothDone();
    mkdirSync(join(repo, 'docs/archive/demo'), { recursive: true });
    writeFileSync(join(repo, 'docs/archive/demo/README.md'), '# Demo\n');
    commitAll();

    expect((await archiveError()).summary).toBe(
      'Spec "demo" is already archived in docs/archive/demo',
    );
  });

  describe('with a worktree', () => {
    const worktree = (): string => join(repo, '.specrun', 'worktrees', 'demo');

    beforeEach(() => {
      writeFileSync(join(repo, '.gitignore'), '.specrun/\n');
      commitAll('init');
      git(repo, 'worktree', 'add', '-q', '-b', 'specrun/demo', worktree());
      writeFileSync(join(worktree(), 'docs/demo/events.jsonl'), readEventsFixture());
      git(worktree(), 'add', '-A');
      git(worktree(), 'commit', '-q', '-m', 'run');
    });

    function readEventsFixture(): string {
      return doneTask('D-1', 10, 0.3) + doneTask('D-2', 20, 0.9);
    }

    it('removes the worktree and its branch once merged', async () => {
      git(repo, 'merge', '-q', '--ff-only', 'specrun/demo');

      const result = await archive();

      expect(result.removed).toEqual({
        worktree: '.specrun/worktrees/demo',
        branch: 'specrun/demo',
      });
      expect(existsSync(worktree())).toBe(false);
      expect(git(repo, 'branch', '--list', 'specrun/demo')).toBe('');
      expect(result.history).toEqual({ samples: 2, deviations: 0 });
    });

    it('refuses an unmerged branch and keeps everything', async () => {
      const error = await archiveError(true);

      expect(error.summary).toBe('Branch specrun/demo is not merged into HEAD');
      expect(existsSync(worktree())).toBe(true);
      expect(existsSync(specDir)).toBe(true);
    });

    it('refuses a worktree with uncommitted changes', async () => {
      git(repo, 'merge', '-q', '--ff-only', 'specrun/demo');
      writeFileSync(join(worktree(), 'stray.txt'), 'x');

      expect((await archiveError(true)).summary).toBe(
        'Worktree .specrun/worktrees/demo has uncommitted changes',
      );
    });
  });
});
