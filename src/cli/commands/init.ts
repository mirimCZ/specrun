import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { CONFIG_FILE, findRepoRoot, readJsonFile } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import type { CliDeps } from '../cliDeps.js';

const GUESSED_SCRIPTS = ['typecheck', 'lint', 'test'] as const;
// Exits 1 on purpose: a run with unconfigured verification must not pass silently.
const PLACEHOLDER = { name: 'configure', command: 'echo "configure verify steps" && exit 1' };

interface VerifyStep {
  name: string;
  command: string;
}

function guessVerify(repoRoot: string): { steps: VerifyStep[]; guessed: boolean } {
  const pkg = readJsonFile(join(repoRoot, 'package.json'));
  const scripts =
    pkg.ok && typeof pkg.value === 'object' && pkg.value !== null && 'scripts' in pkg.value
      ? pkg.value.scripts
      : null;
  const steps: VerifyStep[] = [];
  if (typeof scripts === 'object' && scripts !== null) {
    for (const name of GUESSED_SCRIPTS) {
      if (name in scripts) steps.push({ name, command: `npm run ${name}` });
    }
  }
  return steps.length > 0 ? { steps, guessed: true } : { steps: [PLACEHOLDER], guessed: false };
}

/** Appends `line` unless the file already has it. */
function ensureLine(file: string, line: string): void {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((existing) => existing.trim() === line)) return;
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${current}${separator}${line}\n`);
}

export function register(program: Command, deps: CliDeps): void {
  program
    .command('init')
    .description('Create specrun.config.json and the git ignore/attributes entries')
    .option('--force', 'overwrite an existing specrun.config.json')
    .action((options: { force?: boolean }) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const configPath = join(repoRoot, CONFIG_FILE);
      if (existsSync(configPath) && options.force !== true) {
        throw new SpecrunError('config-invalid', `${CONFIG_FILE} already exists`, [
          'use --force to overwrite it',
        ]);
      }
      const { steps, guessed } = guessVerify(repoRoot);
      writeFileSync(configPath, `${JSON.stringify({ verify: steps }, null, 2)}\n`);
      ensureLine(join(repoRoot, '.gitignore'), '.specrun/');
      ensureLine(join(repoRoot, '.gitattributes'), '**/events.jsonl merge=union');
      deps.stdout(`Wrote ${CONFIG_FILE}\n`);
      if (!guessed) {
        deps.stdout(`No typecheck/lint/test scripts found — edit "verify" in ${CONFIG_FILE}.\n`);
      }
    });
}
