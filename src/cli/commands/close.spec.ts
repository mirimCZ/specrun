import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import { doneTask } from '../../../test/fixtures/taskEvents.js';
import { runCommand, type ProcessRunner } from '../../process/run.js';
import { register } from './close.js';

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

let repo: string;
beforeEach(() => {
  repo = makeTempRepo();
  rmSync(join(repo, '.git'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeDemoSpec(repo);
  writeFileSync(join(repo, '.gitignore'), '.specrun/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'spec');
  const worktree = join(repo, '.specrun', 'worktrees', 'demo');
  git(repo, 'worktree', 'add', '-q', '-b', 'specrun/demo', worktree);
  writeFileSync(
    join(worktree, 'docs', 'demo', 'events.jsonl'),
    doneTask('D-1', 5, 0.1) + doneTask('D-2', 5, 0.1),
  );
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'feat: demo');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('specrun close', () => {
  it('reports the merge and the archive', async () => {
    const deps = captureDeps(repo);
    const program = new Command('specrun');
    register(program, deps, { run, isAlive: () => false });
    await program.parseAsync(['node', 'specrun', 'close', 'demo']);

    const out = deps.out.join('');
    expect(out).toContain(
      'merging specrun/demo into main: 1 commit(s), fast-forward\narchiving demo …\n',
    );
    expect(out).toContain('Closed demo: merged specrun/demo into main (fast-forward, 1 commit(s))');
    expect(out).toContain('Archived demo → docs/archive/demo');
    expect(out).toContain('removed worktree .specrun/worktrees/demo and branch specrun/demo');
    expect(out).toContain('Nothing was pushed');
  });
});
