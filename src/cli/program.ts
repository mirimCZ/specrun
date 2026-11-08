import { createRequire } from 'node:module';
import { Command } from 'commander';

// Same relative path from src/cli (tsx, vitest) and dist/cli (build).
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

/** Builds the `specrun` command tree; subcommands are registered by their feature modules. */
export function createProgram(): Command {
  return new Command('specrun')
    .description('Runs implementation specs task by task with Claude, unattended')
    .version(version);
}
