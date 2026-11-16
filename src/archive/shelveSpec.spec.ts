import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempRepo, writeDemoSpec } from '../../test/fixtures/specRepo.js';
import { doneTask } from '../../test/fixtures/taskEvents.js';
import { ConfigSchema, type Config } from '../config/configSchema.js';
import { runCommand, type ProcessRunner } from '../process/run.js';
import { archiveSpec } from './archiveSpec.js';
import { closeSpec } from './closeSpec.js';
import { readArchivedHistory } from './history.js';
import {
  shelveSpec,
  type ShelveOptions,
  type ShelveResult,
  type ShelveStep,
} from './shelveSpec.js';

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

let repo: string;
let remote: string;
let worktree: string;

beforeEach(() => {
  repo = makeTempRepo();
  rmSync(join(repo, '.git'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeDemoSpec(repo);
  writeFileSync(join(repo, 'docs', 'demo', 'README.md'), '# Demo\n\nWhat it does.\n');
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

/** D-1 done on the spec branch with a code change; D-2 stays todo. */
function workOnBranch(cwd: string): void {
  writeFileSync(join(cwd, 'docs', 'demo', 'events.jsonl'), doneTask('D-1', 5, 0.1));
  writeFileSync(join(cwd, 'feature.txt'), 'feature\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'feat: demo (D-1)');
}

async function shelve(
  options: Partial<ShelveOptions> = {},
  cfg: Config = config,
): Promise<{ result: ShelveResult; steps: ShelveStep[] }> {
  const steps: ShelveStep[] = [];
  const result = await shelveSpec(
    { spec: 'demo', reason: 'wrong approach', remote: 'origin', ...options },
    {
      repoRoot: repo,
      config: cfg,
      run,
      now: () => new Date('2026-11-16T10:00:00.000Z'),
      isAlive: () => false,
      onProgress: (step) => void steps.push(step),
    },
  );
  return { result, steps };
}

const deps = {
  config,
  run,
  now: () => new Date('2026-11-16T10:00:00.000Z'),
  isAlive: () => false,
};

describe('shelveSpec', () => {
  it('pushes the branch, archives the worktree log without merging and keeps the branch', async () => {
    workOnBranch(worktree);
    const tip = git(repo, 'rev-parse', 'specrun/demo');
    const { result, steps } = await shelve();

    expect(steps.map((s) => s.step)).toEqual(['push', 'archive']);
    expect(result).toMatchObject({
      branch: 'specrun/demo',
      tip,
      remote: 'origin',
      removedWorktree: '.specrun/worktrees/demo',
      switchedTo: null,
    });
    expect(result.archive.forced).toEqual(['D-2 (todo)']);
    expect(result.archive.history).toEqual({ samples: 1, deviations: 0 });
    expect(git(remote, 'rev-parse', 'specrun/demo')).toBe(tip);
    expect(git(repo, 'branch', '--list', 'specrun/demo')).toContain('specrun/demo');
    expect(existsSync(worktree)).toBe(false);
    expect(existsSync(join(repo, 'docs', 'demo'))).toBe(false);
    expect(existsSync(join(repo, 'feature.txt'))).toBe(false);
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('docs(demo): shelve spec');
    expect(git(repo, 'status', '--porcelain')).toBe('');

    const readme = readFileSync(join(repo, 'docs', 'archive', 'demo', 'README.md'), 'utf8');
    expect(readme).toContain(
      '> Shelved on 2026-11-16 by `specrun shelve` — not merged. Reason: wrong approach. The work ' +
        `is on branch \`specrun/demo\` at \`${tip.slice(0, 7)}\` (pushed to origin); ` +
        '`specrun unshelve demo` merges it.',
    );
    expect(readArchivedHistory(repo, config, 'demo')?.outcome).toEqual({
      kind: 'shelved',
      shelvedAt: '2026-11-16T10:00:00.000Z',
      reason: 'wrong approach',
      branch: 'specrun/demo',
      remote: 'origin',
      tip,
    });
  });

  it('refuses a missing remote and a dirty worktree before changing anything', async () => {
    workOnBranch(worktree);
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(shelve({ remote: 'upstream' })).rejects.toThrow('No remote "upstream"');

    writeFileSync(join(worktree, 'feature.txt'), 'edited\n');
    await expect(shelve()).rejects.toThrow('has uncommitted changes');
    await expect(shelve({ reason: '  ' })).rejects.toThrow('Shelving needs a reason');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(remote, 'branch', '--list')).toBe('');
    expect(existsSync(worktree)).toBe(true);
  });

  it('keeps the branch only locally with no remote', async () => {
    git(repo, 'remote', 'remove', 'origin');
    workOnBranch(worktree);
    const { result, steps } = await shelve({ remote: null });

    expect(steps.map((s) => s.step)).toEqual(['archive']);
    expect(result.remote).toBeNull();
    const readme = readFileSync(join(repo, 'docs', 'archive', 'demo', 'README.md'), 'utf8');
    expect(readme).toContain('(local only)');
  });

  it('switches a checkout left on the spec branch back to main', async () => {
    git(repo, 'worktree', 'remove', worktree);
    git(repo, 'switch', '-q', 'specrun/demo');
    workOnBranch(repo);

    const { result } = await shelve({}, ConfigSchema.parse({ ...config, worktree: false }));
    expect(result).toMatchObject({ switchedTo: 'main', removedWorktree: null });
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(readArchivedHistory(repo, config, 'demo')?.samples).toHaveLength(1);
  });

  it('makes close and archive point at unshelve', async () => {
    workOnBranch(worktree);
    await shelve();
    const options = { spec: 'demo', force: true };
    await expect(closeSpec(options, { ...deps, repoRoot: repo })).rejects.toThrow(
      'Spec "demo" is shelved since 2026-11-16 — specrun/demo is not merged',
    );
    await expect(archiveSpec(options, { ...deps, repoRoot: repo })).rejects.toMatchObject({
      details: ['reason: wrong approach', 'specrun unshelve demo merges it'],
    });
  });
});
