import { createRequire } from 'node:module';
import { Command } from 'commander';
import { defaultCliDeps, type CliDeps } from './cliDeps.js';
import { register as registerAnalyze } from './commands/analyze.js';
import { register as registerDeviations } from './commands/deviations.js';
import { register as registerInit } from './commands/init.js';
import { register as registerRun } from './commands/run.js';
import { register as registerSet } from './commands/set.js';
import { register as registerStats } from './commands/stats.js';
import { register as registerStatus } from './commands/status.js';

// Same relative path from src/cli (tsx, vitest) and dist/cli (build).
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

/** Builds the `specrun` command tree; each subcommand lives in `commands/<name>.ts`. */
export function createProgram(deps: CliDeps = defaultCliDeps()): Command {
  const program = new Command('specrun')
    .description('Runs implementation specs task by task with Claude, unattended')
    .version(version);
  registerInit(program, deps);
  registerRun(program, deps);
  registerStatus(program, deps);
  registerSet(program, deps);
  registerStats(program, deps);
  registerDeviations(program, deps);
  registerAnalyze(program, deps);
  return program;
}
