import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventLine, makeTempRepo, writeDemoSpec } from '../../test/fixtures/specRepo.js';
import { doneTask } from '../../test/fixtures/taskEvents.js';
import { ConfigSchema } from '../config/configSchema.js';
import { runCommand, type ProcessRunner } from '../process/run.js';
import { closeSpec } from './closeSpec.js';
import { HISTORY_FILE, readArchivedHistory, type History } from './history.js';
import { shelveSpec } from './shelveSpec.js';
import {
  unshelveSpec,
  type UnshelveOptions,
  type UnshelveResult,
  type UnshelveStep,
} from './unshelveSpec.js';

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

const config = ConfigSchema.parse({ verify: [{ name: 'ok', command: 'true' }] });
const deps = {
  config,
  run,
  now: () => new Date('2026-11-20T10:00:00.000Z'),
  isAlive: () => false,
};

const SCOPE = { kind: 'scope', what: 'added a flag', why: 'needed' };
const completed = eventLine({
  t: 'task.completed',
  task: 'D-1',
  sessionId: null,
  payload: { summary: 's', commitMessage: 'm', notes: [], deviations: [SCOPE] },
});

let repo: string;
let remote: string;
let worktree: string;

beforeEach(() => {
  repo = makeTempRepo();
  rmSync(join(repo, '.git'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeDemoSpec(repo);
  writeFileSync(join(repo, '.gitignore'), '.specrun/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'spec');
  remote = mkdtempSync(join(tmpdir(), 'specrun-remote-'));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', remote);
  worktree = join(repo, '.specrun', 'worktrees', 'demo');
  git(repo, 'worktree', 'add', '-q', '-b', 'specrun/demo', worktree);
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

/** Work on the spec branch, then shelved; main moves on meanwhile. */
async function shelved(events = doneTask('D-1', 5, 0.1, completed) + doneTask('D-2', 5, 0.1)) {
  writeFileSync(join(worktree, 'docs', 'demo', 'events.jsonl'), events);
  writeFileSync(join(worktree, 'feature.txt'), 'feature\n');
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'feat: demo (D-1)');
  await shelveSpec(
    { spec: 'demo', reason: 'not now', remote: 'origin' },
    { ...deps, repoRoot: repo, now: () => new Date('2026-11-16T10:00:00.000Z') },
  );
  writeFileSync(join(repo, 'other.txt'), 'meanwhile\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'meanwhile');
}

async function unshelve(
  options: Partial<UnshelveOptions> = {},
): Promise<{ result: UnshelveResult; steps: UnshelveStep[] }> {
  const steps: UnshelveStep[] = [];
  const result = await unshelveSpec(
    { spec: 'demo', force: false, merge: true, ...options },
    { ...deps, repoRoot: repo, onProgress: (step) => void steps.push(step) },
  );
  return { result, steps };
}

const archiveReadme = (): string =>
  readFileSync(join(repo, 'docs', 'archive', 'demo', 'README.md'), 'utf8');

describe('unshelveSpec', () => {
  it('revives, merges and archives the spec as merged, deleting the local branch', async () => {
    await shelved();
    const { result, steps } = await unshelve();

    expect(steps.map((s) => s.step)).toEqual([
      'fetch',
      'revive',
      'merge',
      'verify',
      'verify-step',
      'archive',
    ]);
    expect(result).toMatchObject({
      sync: { kind: 'up-to-date' },
      into: 'main',
      carriedReviewed: 0,
      closed: { merge: 'merge-commit', deletedBranch: 'specrun/demo' },
    });
    expect(existsSync(join(repo, 'feature.txt'))).toBe(true);
    expect(existsSync(join(repo, 'docs', 'demo'))).toBe(false);
    expect(git(repo, 'branch', '--list', 'specrun/demo')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'log', '--first-parent', '--format=%s', '-4').split('\n')).toEqual([
      'docs(demo): archive spec',
      "Merge branch 'specrun/demo'",
      'docs(demo): unshelve spec',
      'meanwhile',
    ]);

    const history = readArchivedHistory(repo, config, 'demo');
    expect(history?.outcome).toEqual({
      kind: 'merged',
      shelved: { shelvedAt: '2026-11-16T10:00:00.000Z', reason: 'not now' },
    });
    expect(history?.samples.map((s) => s.task)).toEqual(['D-1', 'D-2']);
    expect(archiveReadme()).toContain(
      'It was shelved on 2026-11-16 (not now) and merged by `specrun unshelve`.',
    );
  });

  it('fetches a branch that only the remote still has', async () => {
    await shelved();
    git(repo, 'branch', '-q', '-D', 'specrun/demo');

    const { result } = await unshelve();
    expect(result.sync).toEqual({ kind: 'created' });
    expect(existsSync(join(repo, 'feature.txt'))).toBe(true);
  });

  it('refuses unfinished tasks before changing anything; --no-merge only revives', async () => {
    await shelved(doneTask('D-1', 5, 0.1));
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(unshelve()).rejects.toThrow('Spec "demo" has unfinished tasks');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);

    const { result } = await unshelve({ merge: false });
    expect(result.closed).toBeNull();
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('docs(demo): unshelve spec');
    expect(existsSync(join(repo, 'docs', 'demo', 'tasks.yaml'))).toBe(true);
    expect(existsSync(join(repo, 'docs', 'archive', 'demo'))).toBe(false);
    expect(git(repo, 'branch', '--list', 'specrun/demo')).toContain('specrun/demo');
  });

  it('lets specrun close finish a spec revived with --no-merge', async () => {
    await shelved(doneTask('D-1', 5, 0.1));
    await unshelve({ merge: false });
    git(repo, 'worktree', 'add', '-q', worktree, 'specrun/demo');
    writeFileSync(
      join(worktree, 'docs', 'demo', 'events.jsonl'),
      doneTask('D-1', 5, 0.1) + doneTask('D-2', 5, 0.1),
    );
    git(worktree, 'commit', '-q', '-am', 'feat: demo (D-2)');

    const closed = await closeSpec({ spec: 'demo', force: false }, { ...deps, repoRoot: repo });
    expect(closed.archive.removed).toEqual({
      worktree: '.specrun/worktrees/demo',
      branch: 'specrun/demo',
    });
    expect(git(repo, 'branch', '--list', 'specrun/demo')).toBe('');
  });

  it('carries review marks of history.json into the branch log and the new archive', async () => {
    await shelved();
    const file = join(repo, 'docs', 'archive', 'demo', HISTORY_FILE);
    const history = JSON.parse(readFileSync(file, 'utf8')) as History;
    history.deviations = history.deviations.map((d) => ({ ...d, reviewed: true }));
    writeFileSync(file, JSON.stringify(history));
    git(repo, 'commit', '-q', '-am', 'review');

    const { result } = await unshelve();
    expect(result.carriedReviewed).toBe(1);
    expect(git(repo, 'log', '--format=%s').split('\n')).toContain(
      'chore(specrun): demo reviewed deviations',
    );
    expect(result.closed?.deletedBranch).toBe('specrun/demo');
    expect(readArchivedHistory(repo, config, 'demo')?.deviations).toMatchObject([
      { what: 'added a flag', reviewed: true },
    ]);
  });

  it('refuses a branch that diverged from the remote', async () => {
    await shelved();
    git(repo, 'branch', '-q', '-f', 'specrun/demo', 'specrun/demo~1');
    git(repo, 'switch', '-q', 'specrun/demo');
    writeFileSync(join(repo, 'local.txt'), 'local\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'local');
    git(repo, 'switch', '-q', 'main');

    await expect(unshelve()).rejects.toThrow('specrun/demo and origin/specrun/demo have diverged');
    expect(existsSync(join(repo, 'docs', 'archive', 'demo'))).toBe(true);
  });

  it('refuses a spec that is not shelved', async () => {
    await expect(unshelve()).rejects.toThrow('Spec "demo" is not shelved');
  });
});
