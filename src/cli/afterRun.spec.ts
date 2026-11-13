import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptedPrompter } from '../../test/fakes/fakePrompter.js';
import {
  captureDeps,
  eventLine,
  makeTempRepo,
  writeDemoSpec,
} from '../../test/fixtures/specRepo.js';
import { doneTask } from '../../test/fixtures/taskEvents.js';
import { ConfigSchema } from '../config/configSchema.js';
import { SpecrunError } from '../errors.js';
import { runCommand, type ProcessRunner } from '../process/run.js';
import { afterRun, allDone, type AfterRunInput } from './afterRun.js';
import type { Prompter } from './prompter.js';

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
const config = ConfigSchema.parse({ verify: [{ name: 'ok', command: 'true' }] });

const deviation = eventLine({
  t: 'task.completed',
  task: 'D-1',
  sessionId: null,
  payload: {
    summary: 's',
    commitMessage: 'm',
    notes: [],
    deviations: [{ kind: 'scope', what: 'extra file', why: 'needed' }],
  },
});

let repo: string;
let specDir: string;

function finish(withDeviation: boolean): void {
  writeFileSync(
    join(specDir, 'events.jsonl'),
    doneTask('D-1', 5, 0.1, withDeviation ? deviation : '') + doneTask('D-2', 5, 0.1),
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'done');
}

beforeEach(() => {
  repo = makeTempRepo();
  rmSync(join(repo, '.git'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  specDir = writeDemoSpec(repo);
  writeFileSync(join(repo, '.gitignore'), '.specrun/\n');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

interface Trace {
  calls: string[];
  prompts: string[];
}

async function answer(
  answers: string[],
  input: Partial<AfterRunInput> = {},
  prompter?: () => Prompter,
): Promise<Trace> {
  const calls: string[] = [];
  const scripted = createScriptedPrompter(answers);
  const deps = {
    ...captureDeps(repo),
    interactive: true,
    prompter: prompter ?? (() => scripted.prompter),
  };
  await afterRun(
    {
      repoRoot: repo,
      config,
      specs: ['demo'],
      rerun: () => {
        calls.push('rerun');
        return Promise.resolve(true);
      },
      review: () => {
        calls.push('review');
        return Promise.resolve(0);
      },
      close: () => {
        calls.push('close');
        return Promise.resolve();
      },
      closeCommand: 'specrun close demo',
      run,
      ...input,
    },
    deps,
  );
  calls.push(...deps.out);
  return { calls, prompts: scripted.prompts };
}

describe('afterRun', () => {
  it('offers the review, then the close', async () => {
    finish(true);
    const { calls, prompts } = await answer(['', 'y']);
    expect(prompts).toEqual([
      'Run specrun review on the finished specs? [Y/n] ',
      'Run specrun close on the finished specs? [Y/n] ',
    ]);
    expect(calls).toEqual(['review', 'close']);
  });

  it('exits when the review is declined', async () => {
    finish(true);
    const { calls } = await answer(['n']);
    expect(calls).toEqual([]);
  });

  it('goes straight to the close without deviations', async () => {
    finish(false);
    const { calls, prompts } = await answer(['']);
    expect(prompts).toEqual(['Run specrun close on the finished specs? [Y/n] ']);
    expect(calls).toEqual(['close']);
  });

  it('commits what the review changed and runs the tasks it added before closing', async () => {
    finish(true);
    const review = (): Promise<number> => {
      // A fix task D-3, as the review adds them.
      writeFileSync(
        join(specDir, 'tasks.yaml'),
        `title: Demo
tasks:
  - { id: D-1, title: First, phase: 1, needs: [], model: default, size: S }
  - { id: D-2, title: Second, phase: 1, needs: [D-1], model: strong, size: M }
  - { id: D-3, title: Fix, phase: 2, needs: [], model: default, size: S }
`,
      );
      writeFileSync(join(specDir, 'tasks', 'D-3.md'), '# D-3\n');
      return Promise.resolve(0);
    };
    const { calls, prompts } = await answer(['', '', '', ''], { review });

    expect(prompts).toEqual([
      'Run specrun review on the finished specs? [Y/n] ',
      'Commit the review changes in the main checkout? [Y/n] ',
      'Run the 1 new task(s)? [Y/n] ',
      'Run specrun close on the finished specs? [Y/n] ',
    ]);
    expect(calls).toEqual(['rerun', 'close']);
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('docs(demo): review deviations');
  });

  it('does not offer the close over changes that were there before', async () => {
    finish(false);
    writeFileSync(join(repo, 'scratch.txt'), 'mine\n');
    const { calls, prompts } = await answer([]);
    expect(prompts).toEqual([]);
    expect(calls.join('')).toContain('Not offering specrun close demo: uncommitted changes');
  });

  it('takes Ctrl+C at a question as no', async () => {
    finish(true);
    const cancelled: Prompter = {
      text: () => Promise.reject(new Error('unused')),
      confirm: () => Promise.reject(new SpecrunError('cancelled', 'Cancelled')),
      close: () => undefined,
    };
    const { calls } = await answer([], {}, () => cancelled);
    expect(calls).toEqual([]);
  });
});

describe('allDone', () => {
  it('needs every task of every spec done', () => {
    expect(allDone(repo, config, ['demo'])).toBe(false);
    finish(false);
    expect(allDone(repo, config, ['demo'])).toBe(true);
    expect(allDone(repo, config, [])).toBe(false);
  });
});
