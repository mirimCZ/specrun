import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { VerifyStep } from '../verify/verify.js';
import { DEFAULT_SPECS_DIR } from '../config/configSchema.js';
import { readJsonFile } from '../config/loadConfig.js';
import { runShell, type ProcessRunner } from '../process/run.js';
import type { Prompter } from './prompter.js';

const GUESSED_SCRIPTS = ['typecheck', 'lint', 'test'] as const;
// Exits 1 on purpose: a run with unconfigured verification must not pass silently.
export const PLACEHOLDER_CHECK = 'echo "configure the check command" && exit 1';
const CHECK_TAIL_LINES = 15;

/** Lockfile → package manager and its reproducible install, first match wins. */
const LOCKFILES: readonly { file: string; pm: string; setup: string }[] = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm', setup: 'pnpm install --frozen-lockfile' },
  { file: 'yarn.lock', pm: 'yarn', setup: 'yarn install --immutable' },
  { file: 'bun.lock', pm: 'bun', setup: 'bun install --frozen-lockfile' },
  { file: 'bun.lockb', pm: 'bun', setup: 'bun install --frozen-lockfile' },
  { file: 'package-lock.json', pm: 'npm', setup: 'npm ci' },
];

export interface ProjectDefaults {
  setup: string | null;
  check: string;
  /** False when package.json has no script the check could be built from. */
  checkFound: boolean;
  /** Ignored `.env*` files of the main checkout, which a new worktree would miss. */
  envFiles: string[];
}

export interface WizardAnswers {
  specsDir: string;
  worktree: boolean;
  worktreeFiles: string[];
  setup: string | null;
  verify: VerifyStep[];
  limits: { sessionMinLeft: number; weeklyMinLeft: number };
}

// Lenient: a hand-edited config with a wrong value still prefills everything else.
const ExistingSchema = z.looseObject({
  specsDir: z.string().min(1).optional().catch(undefined),
  worktree: z.boolean().optional().catch(undefined),
  worktreeFiles: z.array(z.string()).optional().catch(undefined),
  setup: z.string().nullable().optional().catch(undefined),
  verify: z
    .array(z.object({ name: z.string(), command: z.string() }))
    .optional()
    .catch(undefined),
  limits: z
    .looseObject({
      sessionMinLeft: z.number().optional().catch(undefined),
      weeklyMinLeft: z.number().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});
type Existing = z.infer<typeof ExistingSchema>;

function scriptsOf(repoRoot: string): Record<string, unknown> | null {
  const pkg = readJsonFile(join(repoRoot, 'package.json'));
  if (!pkg.ok || typeof pkg.value !== 'object' || pkg.value === null) return null;
  const scripts = 'scripts' in pkg.value ? pkg.value.scripts : {};
  return typeof scripts === 'object' && scripts !== null
    ? (scripts as Record<string, unknown>)
    : {};
}

async function ignoredEnvFiles(repoRoot: string, run: ProcessRunner): Promise<string[]> {
  // `--directory` lists an ignored folder (node_modules/) once instead of every file in it.
  const result = await run(
    'git',
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
    { cwd: repoRoot },
  );
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .filter((path) => path !== '' && !path.endsWith('/') && basename(path).startsWith('.env'))
    .sort();
}

export async function detectDefaults(
  repoRoot: string,
  run: ProcessRunner,
): Promise<ProjectDefaults> {
  const scripts = scriptsOf(repoRoot);
  const lock = LOCKFILES.find(({ file }) => existsSync(join(repoRoot, file)));
  const pm = lock?.pm ?? 'npm';
  const setup = lock?.setup ?? (scripts === null ? null : 'npm install');
  const envFiles = await ignoredEnvFiles(repoRoot, run);
  if (scripts === null) return { setup, check: PLACEHOLDER_CHECK, checkFound: false, envFiles };
  if ('check' in scripts) return { setup, check: `${pm} run check`, checkFound: true, envFiles };
  const guessed = GUESSED_SCRIPTS.filter((name) => name in scripts);
  if (guessed.length === 0) {
    return { setup, check: `${pm} run check`, checkFound: false, envFiles };
  }
  const check = guessed.map((name) => `${pm} run ${name}`).join(' && ');
  return { setup, check, checkFound: true, envFiles };
}

export function parseExisting(raw: unknown): Existing {
  const parsed = ExistingSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

/** `--yes`, and the prefill of every question. */
export function defaultAnswers(defaults: ProjectDefaults, existing: Existing): WizardAnswers {
  return {
    specsDir: existing.specsDir ?? DEFAULT_SPECS_DIR,
    worktree: existing.worktree ?? true,
    worktreeFiles: existing.worktreeFiles ?? [],
    setup: existing.setup === undefined ? defaults.setup : existing.setup,
    verify: existing.verify ?? [{ name: 'check', command: defaults.check }],
    limits: {
      sessionMinLeft: existing.limits?.sessionMinLeft ?? 15,
      weeklyMinLeft: existing.limits?.weeklyMinLeft ?? 5,
    },
  };
}

export interface CheckResult {
  ok: boolean;
  durationMs: number;
  /** Last lines of the failed step's output. */
  tail: string[];
}

export async function runCheck(
  steps: readonly VerifyStep[],
  cwd: string,
  run: ProcessRunner,
): Promise<CheckResult> {
  let durationMs = 0;
  for (const step of steps) {
    const result = await runShell(step.command, { cwd }, run);
    durationMs += result.durationMs;
    if (result.code !== 0) {
      const lines = `${result.stdout}${result.stderr}`.trim().split('\n');
      return { ok: false, durationMs, tail: lines.slice(-CHECK_TAIL_LINES) };
    }
  }
  return { ok: true, durationMs, tail: [] };
}

export interface WizardInput {
  prompter: Prompter;
  defaults: ProjectDefaults;
  existing: Existing;
  write: (text: string) => void;
  check: (steps: readonly VerifyStep[]) => Promise<CheckResult>;
}

async function askPercent(prompter: Prompter, question: string, fallback: number): Promise<number> {
  for (;;) {
    const answer = Number(await prompter.text(question, String(fallback)));
    if (Number.isFinite(answer) && answer >= 0 && answer <= 100) return answer;
  }
}

async function askSpecsDir(prompter: Prompter, fallback: string): Promise<string> {
  for (;;) {
    // `spec/` would print as `spec//` wherever the folder is named.
    const answer = (await prompter.text('Folder with the specs', fallback)).replace(/\/+$/, '');
    if (answer !== '') return answer;
  }
}

async function askCheck(prompter: Prompter, current: VerifyStep[]): Promise<VerifyStep[]> {
  if (current.length > 1) {
    const names = current.map((step) => step.name).join(', ');
    if (await prompter.confirm(`Keep the ${current.length} verify steps (${names})?`, true)) {
      return current;
    }
  }
  const fallback = current.length === 1 ? (current[0]?.command ?? '') : '';
  const command = await prompter.text('Check command run after each task', fallback);
  return [{ name: current.length === 1 ? (current[0]?.name ?? 'check') : 'check', command }];
}

/** The questions in the order they depend on each other: workspace first, then what it needs. */
export async function askConfig(input: WizardInput): Promise<WizardAnswers> {
  const { prompter, defaults, write } = input;
  const answers = defaultAnswers(defaults, input.existing);

  answers.specsDir = await askSpecsDir(prompter, answers.specsDir);

  write('Run each spec in its own git worktree? With "no" it runs in this checkout on the\n');
  write('spec branch: the checkout must be clean and you should not edit it during a run.\n');
  answers.worktree = await prompter.confirm('Use a worktree', answers.worktree);

  if (answers.worktree) {
    const offered = [...new Set([...answers.worktreeFiles, ...defaults.envFiles])].sort();
    if (offered.length > 0) {
      const copy = await prompter.confirm(
        `Copy ignored files into new worktrees (${offered.join(', ')})?`,
        input.existing.worktreeFiles === undefined || answers.worktreeFiles.length > 0,
      );
      answers.worktreeFiles = copy ? offered : [];
    }
    const setup = await prompter.text(
      'Setup command for a new worktree (- for none)',
      answers.setup ?? '-',
    );
    answers.setup = setup === '-' ? null : setup;
  }

  if (!defaults.checkFound && input.existing.verify === undefined) {
    write('No check, typecheck, lint or test script found in package.json.\n');
  }
  answers.verify = await askCheck(prompter, answers.verify);

  answers.limits.sessionMinLeft = await askPercent(
    prompter,
    'Wait before a task while the 5-hour window has less than … % left',
    answers.limits.sessionMinLeft,
  );
  answers.limits.weeklyMinLeft = await askPercent(
    prompter,
    'Stop the run while the weekly window has less than … % left',
    answers.limits.weeklyMinLeft,
  );

  // A typo in the check would otherwise surface only after the first task's agent session.
  while (await prompter.confirm('Run the check now?', true)) {
    write(`running ${answers.verify.map((step) => step.command).join(' → ')} …\n`);
    const result = await input.check(answers.verify);
    const seconds = Math.round(result.durationMs / 1000);
    if (result.ok) {
      write(`✔ check passed (${seconds}s)\n`);
      break;
    }
    write(`✖ check failed (${seconds}s):\n${result.tail.map((line) => `  ${line}`).join('\n')}\n`);
    if (!(await prompter.confirm('Change the check command?', true))) break;
    answers.verify = await askCheck(prompter, [
      { name: 'check', command: answers.verify.map((step) => step.command).join(' && ') },
    ]);
  }
  return answers;
}

/** The answers over the existing file: keys the wizard doesn't ask about stay as they were. */
export function mergeConfig(
  raw: Record<string, unknown> | null,
  answers: WizardAnswers,
): Record<string, unknown> {
  const base = raw ?? {};
  const limits =
    typeof base['limits'] === 'object' && base['limits'] !== null ? base['limits'] : {};
  const merged: Record<string, unknown> = {
    ...base,
    specsDir: answers.specsDir,
    worktree: answers.worktree,
    worktreeFiles: answers.worktreeFiles,
    setup: answers.setup,
    verify: answers.verify,
    limits: { ...limits, ...answers.limits },
  };
  if (answers.worktreeFiles.length === 0) delete merged['worktreeFiles'];
  return merged;
}
