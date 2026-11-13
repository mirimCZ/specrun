import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config/configSchema.js';
import { EVENTS_FILE } from '../events/eventStore.js';
import { worktreePath } from '../git/worktree.js';
import { specDir } from '../spec/loadSpec.js';
import { createTerminalPrompter, type Prompter } from './prompter.js';

/** What every command needs from its surroundings; tests pass temp dirs and capturing writers. */
export interface CliDeps {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  /** Both stdin and stdout are terminals, so questions can be asked. */
  interactive: boolean;
  prompter: () => Prompter;
}

export function defaultCliDeps(): CliDeps {
  return {
    cwd: process.cwd(),
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    env: process.env,
    now: () => new Date(),
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    prompter: () => createTerminalPrompter(),
  };
}

export interface ActiveSpecFiles {
  /** Root the spec is read from: the worktree while it exists (SRD-4), else the checkout. */
  base: string;
  worktree: string | null;
  eventsFile: string;
}

/** The worktree's copy is the live one during and after a run; the checkout's lags behind. */
export function activeSpecFiles(repoRoot: string, config: Config, spec: string): ActiveSpecFiles {
  const worktree = worktreePath(repoRoot, spec);
  const hasWorktree = existsSync(worktree);
  const base = hasWorktree ? worktree : repoRoot;
  return {
    base,
    worktree: hasWorktree ? worktree : null,
    eventsFile: join(specDir(base, config, spec), EVENTS_FILE),
  };
}
