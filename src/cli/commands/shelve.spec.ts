import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDeps, makeTempRepo, writeDemoSpec } from '../../../test/fixtures/specRepo.js';
import { doneTask } from '../../../test/fixtures/taskEvents.js';
import { runCommand, type ProcessRunner } from '../../process/run.js';
import { register as registerShelve } from './shelve.js';
import { register as registerUnshelve } from './unshelve.js';

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
let remote: string;
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
  const worktree = join(repo, '.specrun', 'worktrees', 'demo');
  git(repo, 'worktree', 'add', '-q', '-b', 'specrun/demo', worktree);
  writeFileSync(
    join(worktree, 'specrun', 'specs', 'demo', 'events.jsonl'),
    doneTask('D-1', 5, 0.1),
  );
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'feat: demo');
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

async function specrun(...args: string[]): Promise<string> {
  const deps = captureDeps(repo);
  const program = new Command('specrun').exitOverride();
  registerShelve(program, deps, { run, isAlive: () => false });
  registerUnshelve(program, deps, { run, isAlive: () => false });
  await program.parseAsync(['node', 'specrun', ...args]);
  return deps.out.join('');
}

describe('specrun shelve / unshelve', () => {
  it('reports the push and the archive, then the revive and the merge', async () => {
    const tip = git(repo, 'rev-parse', 'specrun/demo').slice(0, 7);
    const shelved = await specrun('shelve', 'demo', '--reason', 'not now');
    expect(shelved).toContain('pushing specrun/demo to origin …\narchiving demo …\n');
    expect(shelved).toContain(`Shelved demo: specrun/demo at ${tip} pushed to origin, not merged`);
    expect(shelved).toContain('  unfinished: D-2 (todo)');
    expect(shelved).toContain(
      '  removed worktree .specrun/worktrees/demo, kept branch specrun/demo',
    );

    const unshelved = await specrun('unshelve', 'demo', '--force');
    expect(unshelved).toContain(
      'fetching specrun/demo from origin …\nbringing demo back on main\n',
    );
    expect(unshelved).toContain('Closed demo: merged specrun/demo into main (merge-commit');
    expect(unshelved).toContain('  deleted branch specrun/demo');
    expect(unshelved).toContain('git push origin --delete specrun/demo');
  });

  it('needs a reason off a terminal', async () => {
    await expect(specrun('shelve', 'demo')).rejects.toThrow('Shelving needs a reason');
  });

  it('keeps the branch local with --no-push', async () => {
    git(repo, 'remote', 'remove', 'origin');
    const out = await specrun('shelve', 'demo', '--reason', 'x', '--no-push');
    expect(out).toContain('kept only locally (--no-push)');
  });
});
