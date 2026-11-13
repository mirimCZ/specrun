import { join } from 'node:path';
import type { Config } from '../config/configSchema.js';
import { EVENTS_FILE } from '../events/eventStore.js';
import { specWorkspace, type SpecWorkspace } from '../git/workspace.js';
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
  workspace: SpecWorkspace['kind'];
  eventsFile: string;
}

/** The worktree's copy is the live one during and after a run; the checkout's lags behind. */
export function activeSpecFiles(repoRoot: string, config: Config, spec: string): ActiveSpecFiles {
  const workspace = specWorkspace(repoRoot, config, spec);
  return {
    base: workspace.path,
    worktree: workspace.kind === 'checkout' ? null : workspace.path,
    workspace: workspace.kind,
    eventsFile: join(specDir(workspace.path, config, spec), EVENTS_FILE),
  };
}
