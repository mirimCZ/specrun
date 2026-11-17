import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { createFakeClock } from '../../test/fakes/fakeClock.js';
import { createFakeSession, type FakeSegment } from '../../test/fakes/fakeSession.js';
import { ConfigSchema } from '../config/configSchema.js';
import type { EventOf } from '../events/eventSchema.js';
import { readEvents } from '../events/eventStore.js';
import { runCommand, type ProcessRunner } from '../process/run.js';
import { nullReporter, type RunPlan, type RunReporter } from './reporter.js';
import { planAll, runAll, type RunAllDeps } from './runAll.js';
import type { RunResult } from './runSpec.js';
import { createStopRequest } from './stopRequest.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const run: ProcessRunner = (cmd, args, opts) => runCommand(cmd, args, { ...opts, env });
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

let dir: string;
let repo: string;
let shared: string;
const config = (): ReturnType<typeof ConfigSchema.parse> =>
  ConfigSchema.parse({
    verify: [{ name: 'check', command: 'true' }],
    transcriptsDir: join(dir, 'transcripts'),
  });

/** A spec with one task `<PREFIX>-1`, committed on main. */
function addSpec(name: string, prefix: string, extra: Record<string, unknown> = {}): void {
  const specDir = join(repo, 'specrun', 'specs', name);
  mkdirSync(join(specDir, 'tasks'), { recursive: true });
  const task = {
    id: `${prefix}-1`,
    title: 'One',
    phase: 1,
    needs: [],
    model: 'default',
    size: 'M',
  };
  writeFileSync(join(specDir, 'tasks.yaml'), stringify({ title: name, ...extra, tasks: [task] }));
  writeFileSync(join(specDir, 'tasks', `${prefix}-1.md`), '# brief\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', `spec ${name}`);
}

function deps(segments: FakeSegment[], extra: Partial<RunAllDeps> = {}): RunAllDeps {
  return {
    repoRoot: repo,
    config: config(),
    session: createFakeSession(segments, { gitEnv: env }),
    run,
    clock: createFakeClock(new Date('2026-11-13T10:00:00.000Z')),
    probeUsage: () => Promise.resolve(null),
    reporter: nullReporter,
    signal: new AbortController().signal,
    version: '0.0.0-test',
    ...extra,
  };
}

const runStarted = (spec: string): EventOf<'run.started'>[] =>
  readEvents(join(shared, 'specrun', 'specs', spec, 'events.jsonl')).events.filter(
    (e): e is EventOf<'run.started'> => e.t === 'run.started',
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, '.gitignore'), '.specrun/\n');
  shared = join(repo, '.specrun', 'worktrees', '.all');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runAll', () => {
  it('runs every spec alphabetically in the shared worktree, on one branch', async () => {
    addSpec('beta', 'B');
    addSpec('alpha', 'A');
    const plans: RunPlan[] = [];
    const reporter: RunReporter = { ...nullReporter, plan: (plan) => void plans.push(plan) };
    const result = await runAll(
      { base: 'HEAD', retryBlocked: false },
      deps([{ edits: { 'a.txt': 'a\n' } }, { edits: { 'b.txt': 'b\n' } }], { reporter }),
    );

    expect(result).toMatchObject({ exitCode: 0, merged: 0 });
    expect(result.specs.map((s) => [s.spec, s.outcome.kind, s.tasks.done])).toEqual([
      ['alpha', 'ran', 1],
      ['beta', 'ran', 1],
    ]);
    expect(result.specs[0]?.costUsd).toBeCloseTo(0.1);
    expect(plans.map((p) => [p.spec.title, p.position])).toEqual([
      ['alpha', { index: 1, total: 2 }],
      ['beta', { index: 2, total: 2 }],
    ]);
    expect(runStarted('beta')).toMatchObject([
      { branch: 'specrun/all', options: { workspace: 'shared' } },
    ]);
    // The later spec builds on the earlier one's commits.
    expect(git(repo, 'log', '--format=%s', 'main..specrun/all').split('\n')).toEqual([
      'chore(specrun): beta run log',
      'feat: implement (B-1)',
      'chore(specrun): alpha run log',
      'feat: implement (A-1)',
    ]);
    expect(existsSync(join(repo, '.specrun', 'worktrees', 'alpha'))).toBe(false);
  });

  it('skips specs with nothing to run, without touching their log', async () => {
    addSpec('alpha', 'A');
    addSpec('beta', 'B');
    await runAll({ base: 'HEAD', retryBlocked: false }, deps([{}, {}]));
    const again = await runAll({ base: 'HEAD', retryBlocked: false }, deps([]));

    expect(again.specs.map((s) => s.outcome)).toEqual([
      { kind: 'skipped', reason: 'done' },
      { kind: 'skipped', reason: 'done' },
    ]);
    expect(runStarted('alpha')).toHaveLength(1);
  });

  it('stops at the first spec that does not end done', async () => {
    addSpec('alpha', 'A');
    addSpec('beta', 'B');
    const paused: RunResult = { exitCode: 75, reason: 'paused-weekly' };
    const result = await runAll(
      { base: 'HEAD', retryBlocked: false },
      deps([], { runSpec: () => Promise.resolve(paused) }),
    );
    expect(result).toMatchObject({ exitCode: 75, message: 'alpha: paused-weekly' });
    expect(result.specs.map((s) => s.outcome.kind)).toEqual(['ran', 'not-run']);
  });

  it('starts no spec after a stop request', async () => {
    addSpec('alpha', 'A');
    const stop = createStopRequest();
    stop.request();
    const result = await runAll({ base: 'HEAD', retryBlocked: false }, deps([], { stop }));
    expect(result).toMatchObject({ exitCode: 0, message: 'stopped on request' });
    expect(result.specs.map((s) => s.outcome.kind)).toEqual(['not-run']);
  });

  it('merges specs committed on the base since the last run', async () => {
    addSpec('alpha', 'A');
    await runAll({ base: 'main', retryBlocked: false }, deps([{}]));
    addSpec('beta', 'B');
    const result = await runAll({ base: 'main', retryBlocked: false }, deps([{}]));

    expect(result.merged).toBe(1);
    expect(result.specs.map((s) => [s.spec, s.outcome.kind])).toEqual([
      ['alpha', 'skipped'],
      ['beta', 'ran'],
    ]);
  });

  it('refuses before anything runs when a spec has its own worktree or branch', async () => {
    addSpec('alpha', 'A');
    addSpec('beta', 'B');
    git(repo, 'branch', 'specrun/beta');
    await expect(runAll({ base: 'HEAD', retryBlocked: false }, deps([]))).rejects.toMatchObject({
      code: 'worktree-exists',
      details: ['beta: own branch specrun/beta', expect.stringContaining('close them first')],
    });
    expect(existsSync(shared)).toBe(false);
  });

  it('refuses a spec that sets its own branch', async () => {
    addSpec('alpha', 'A', { branch: 'feature/alpha' });
    await expect(runAll({ base: 'HEAD', retryBlocked: false }, deps([]))).rejects.toMatchObject({
      code: 'spec-invalid',
      details: [
        expect.stringContaining('alpha: tasks.yaml sets branch feature/alpha'),
        expect.any(String),
      ],
    });
  });
});

describe('planAll', () => {
  it('lists what would run and why it would refuse, changing nothing', async () => {
    addSpec('alpha', 'A');
    addSpec('beta', 'B');
    git(repo, 'branch', 'specrun/beta');
    const plan = await planAll(
      { base: 'HEAD', retryBlocked: false },
      { repoRoot: repo, config: config(), run },
    );

    expect(plan).toEqual({
      specs: [
        {
          spec: 'alpha',
          kind: 'todo',
          tasks: { done: 0, total: 1, blocked: 0, costUsd: 0 },
          runnable: 1,
        },
        {
          spec: 'beta',
          kind: 'todo',
          tasks: { done: 0, total: 1, blocked: 0, costUsd: 0 },
          runnable: 1,
        },
      ],
      conflicts: ['beta: own branch specrun/beta'],
      baseCommits: null,
    });
    expect(existsSync(shared)).toBe(false);
  });
});
