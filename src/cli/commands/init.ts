import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { CONFIG_FILE, findRepoRoot, readJsonFile } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import { ensureLine } from '../../git/ensureLine.js';
import { runCommand, type ProcessRunner } from '../../process/run.js';
import type { CliDeps } from '../cliDeps.js';
import {
  askConfig,
  defaultAnswers,
  detectDefaults,
  mergeConfig,
  parseExisting,
  runCheck,
} from '../configWizard.js';

export interface SetupConfigOptions {
  /** Ask the questions; otherwise detected defaults and the existing values are written. */
  interactive: boolean;
  run?: ProcessRunner;
}

function readExisting(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const json = readJsonFile(path);
  if (!json.ok || typeof json.value !== 'object' || json.value === null) {
    throw new SpecrunError('config-invalid', `${CONFIG_FILE} is not a JSON object`, [
      json.ok ? 'fix or delete it, then run specrun init again' : json.error,
    ]);
  }
  return json.value as Record<string, unknown>;
}

/** Writes specrun.config.json (merged into an existing one) and the git ignore/attributes lines. */
export async function setupConfig(
  repoRoot: string,
  deps: CliDeps,
  options: SetupConfigOptions,
): Promise<void> {
  const run = options.run ?? runCommand;
  const path = join(repoRoot, CONFIG_FILE);
  const raw = readExisting(path);
  const existing = parseExisting(raw);
  const defaults = await detectDefaults(repoRoot, run);
  let answers = defaultAnswers(defaults, existing);
  if (options.interactive) {
    const prompter = deps.prompter();
    try {
      deps.stdout(`Setting up specrun in ${repoRoot} — Enter keeps the value in [brackets].\n`);
      answers = await askConfig({
        prompter,
        defaults,
        existing,
        write: deps.stdout,
        check: (steps) => runCheck(steps, repoRoot, run),
      });
    } finally {
      prompter.close();
    }
  }
  writeFileSync(path, `${JSON.stringify(mergeConfig(raw, answers), null, 2)}\n`);
  ensureLine(join(repoRoot, '.gitignore'), '.specrun/');
  ensureLine(join(repoRoot, '.gitattributes'), '**/events.jsonl merge=union');
  deps.stdout(`${raw === null ? 'Wrote' : 'Updated'} ${CONFIG_FILE}\n`);
  if (!options.interactive && !defaults.checkFound && existing.verify === undefined) {
    deps.stdout(`No check script found — edit "verify" in ${CONFIG_FILE}.\n`);
  }
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('init')
    .description('Set up specrun.config.json interactively (or with --yes) and the git entries')
    .option('-y, --yes', 'no questions: detected defaults, existing values kept')
    .option('--force', 'with --yes: overwrite an existing specrun.config.json')
    .action(async (options: { yes?: boolean; force?: boolean }) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const interactive = deps.interactive && options.yes !== true;
      // Without questions an existing config would change silently, so that needs --force.
      if (!interactive && existsSync(join(repoRoot, CONFIG_FILE)) && options.force !== true) {
        throw new SpecrunError('config-invalid', `${CONFIG_FILE} already exists`, [
          'run specrun init in a terminal to change it, or use --force',
        ]);
      }
      await setupConfig(repoRoot, deps, { interactive });
    });
}
