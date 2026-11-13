import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptedPrompter } from '../../../test/fakes/fakePrompter.js';
import { captureDeps, makeTempRepo, type CapturedDeps } from '../../../test/fixtures/specRepo.js';
import { PLACEHOLDER_CHECK } from '../configWizard.js';
import { createProgram } from '../program.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function init(...args: string[]): Promise<void> {
  await createProgram(captureDeps(dir)).parseAsync(['node', 'specrun', 'init', ...args]);
}

/** `init` in a terminal; returns the prompts it showed and its output. */
async function initInteractive(
  answers: readonly string[],
): Promise<{ prompts: string[]; deps: CapturedDeps }> {
  const scripted = createScriptedPrompter(answers);
  const deps: CapturedDeps = {
    ...captureDeps(dir),
    interactive: true,
    prompter: () => scripted.prompter,
  };
  await createProgram(deps).parseAsync(['node', 'specrun', 'init']);
  return { prompts: scripted.prompts, deps };
}

const read = (file: string): string => readFileSync(join(dir, file), 'utf8');
const config = (): Record<string, unknown> =>
  JSON.parse(read('specrun.config.json')) as Record<string, unknown>;
const writePackage = (scripts: Record<string, string>): void =>
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));

/** A real repository, for the `git ls-files` lookup of ignored `.env` files. */
function gitRepo(): void {
  rmSync(join(dir, '.git'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
}

describe('specrun init --yes', () => {
  it('joins the guessed scripts into one check and picks setup from the lockfile', async () => {
    writePackage({ test: 'vitest', typecheck: 'tsc', build: 'x' });
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    await init('--yes');
    expect(config()).toEqual({
      worktree: true,
      setup: 'pnpm install --frozen-lockfile',
      verify: [{ name: 'check', command: 'pnpm run typecheck && pnpm run test' }],
      limits: { sessionMinLeft: 15, weeklyMinLeft: 5 },
    });
  });

  it('prefers a check script and npm ci with a package-lock', async () => {
    writePackage({ check: 'tsc && vitest', test: 'vitest' });
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    await init('--yes');
    expect(config()).toMatchObject({
      setup: 'npm ci',
      verify: [{ name: 'check', command: 'npm run check' }],
    });
  });

  it('writes a failing placeholder check without package.json', async () => {
    await init('--yes');
    expect(config()).toMatchObject({ setup: null, verify: [{ command: PLACEHOLDER_CHECK }] });
  });

  it('adds the ignore and attributes lines once', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    await init('--yes');
    await init('--yes', '--force');
    expect(read('.gitignore')).toBe('node_modules/\n.specrun/\n');
    expect(read('.gitattributes')).toBe('**/events.jsonl merge=union\n');
  });

  it('refuses to change a config without --force and keeps other keys with it', async () => {
    writeFileSync(join(dir, 'specrun.config.json'), '{"custom":true}');
    await expect(init('--yes')).rejects.toThrow(/already exists/);
    expect(read('specrun.config.json')).toBe('{"custom":true}');
    await init('--yes', '--force');
    expect(config()).toMatchObject({ custom: true, worktree: true });
  });
});

describe('specrun init in a terminal', () => {
  it('asks in order, offers ignored .env files and tries the check', async () => {
    gitRepo();
    writePackage({ check: 'true' });
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    writeFileSync(join(dir, '.gitignore'), '.env*\n');
    writeFileSync(join(dir, '.env'), 'KEY=1\n');
    const { prompts, deps } = await initInteractive(['', '', 'npm install', 'true', '20', '', '']);

    expect(prompts).toEqual([
      'Use a worktree [Y/n] ',
      'Copy ignored files into new worktrees (.env)? [Y/n] ',
      'Setup command for a new worktree (- for none) [npm ci]: ',
      'Check command run after each task [npm run check]: ',
      'Wait before a task while the 5-hour window has less than … % left [15]: ',
      'Stop the run while the weekly window has less than … % left [5]: ',
      'Run the check now? [Y/n] ',
    ]);
    expect(deps.out.join('')).toContain('✔ check passed');
    expect(config()).toEqual({
      worktree: true,
      worktreeFiles: ['.env'],
      setup: 'npm install',
      verify: [{ name: 'check', command: 'true' }],
      limits: { sessionMinLeft: 20, weeklyMinLeft: 5 },
    });
  });

  it('skips the worktree questions without a worktree and keeps the other keys', async () => {
    writeFileSync(
      join(dir, 'specrun.config.json'),
      JSON.stringify({
        models: { strong: 'opus' },
        setup: 'npm ci',
        verify: [
          { name: 'typecheck', command: 'npm run typecheck' },
          { name: 'test', command: 'npm test' },
        ],
        limits: { sessionMinLeft: 30 },
      }),
    );
    const { prompts, deps } = await initInteractive(['n', '', '', '', 'n']);

    expect(prompts).toEqual([
      'Use a worktree [Y/n] ',
      'Keep the 2 verify steps (typecheck, test)? [Y/n] ',
      'Wait before a task while the 5-hour window has less than … % left [30]: ',
      'Stop the run while the weekly window has less than … % left [5]: ',
      'Run the check now? [Y/n] ',
    ]);
    expect(deps.out.join('')).toContain('Updated specrun.config.json');
    expect(config()).toEqual({
      models: { strong: 'opus' },
      worktree: false,
      setup: 'npm ci',
      verify: [
        { name: 'typecheck', command: 'npm run typecheck' },
        { name: 'test', command: 'npm test' },
      ],
      limits: { sessionMinLeft: 30, weeklyMinLeft: 5 },
    });
  });

  it('re-asks invalid percentages and offers to fix a failing check', async () => {
    writePackage({ check: 'x' });
    const { prompts, deps } = await initInteractive([
      'n',
      'echo broken >&2; exit 2',
      '150',
      '10',
      '',
      '',
      '',
      'true',
      '',
    ]);

    expect(prompts.filter((p) => p.startsWith('Wait before'))).toHaveLength(2);
    expect(prompts.slice(-3)).toEqual([
      'Change the check command? [Y/n] ',
      'Check command run after each task [echo broken >&2; exit 2]: ',
      'Run the check now? [Y/n] ',
    ]);
    const out = deps.out.join('');
    expect(out).toContain('✖ check failed');
    expect(out).toContain('  broken');
    expect(out).toContain('✔ check passed');
    expect(config()).toMatchObject({
      verify: [{ name: 'check', command: 'true' }],
      limits: { sessionMinLeft: 10 },
    });
  });
});
