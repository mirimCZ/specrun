import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventLine, makeTempRepo, writeDemoSpec } from '../../test/fixtures/specRepo.js';
import { doneTask } from '../../test/fixtures/taskEvents.js';
import { loadRunHistory } from '../cli/specInputs.js';
import { loadConfig } from '../config/loadConfig.js';
import { runCommand, type ProcessRunner } from '../process/run.js';
import { deviationEntries } from '../stats/aggregate.js';
import { gatherReviewContext, readmeFacts } from './reviewContext.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const run: ProcessRunner = (cmd, args, opts) => runCommand(cmd, args, { ...opts, env });
const sh = (dir: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' });

const README = [
  '# Demo',
  '',
  '| ID    | Topic | Decision        |',
  '| ----- | ----- | --------------- |',
  '| DMD-1 | Rules | Never touch X.  |',
  '| DMD-2 | Model | Keep the alias. |',
  '',
  '| #  | Question | Answer |',
  '| -- | -------- | ------ |',
  '| Q1 | Which?   | This.  |',
  '',
].join('\n');

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
  rmSync(join(dir, '.git'), { recursive: true });
  sh(dir, 'init', '-q', '-b', 'main');
  const specDir = writeDemoSpec(dir);
  writeFileSync(join(specDir, 'README.md'), README);
  writeFileSync(join(specDir, 'TASK_PROMPT.md'), 'Run {TASK} carefully.\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'spec');

  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'rules.txt'), 'allow all\n');
  writeFileSync(join(dir, 'src', 'other.txt'), 'untouched by deviations\n');
  writeFileSync(join(specDir, 'PROGRESS.md'), 'generated\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'feat: rules (D-1)\n\nChanged the rules.\n\nSpecrun-Task: D-1');
  const sha = sh(dir, 'rev-parse', 'HEAD').trim();

  const completed = eventLine({
    t: 'task.completed',
    task: 'D-1',
    sessionId: null,
    payload: {
      summary: 's',
      commitMessage: 'm',
      notes: [],
      deviations: [
        { kind: 'spec-bug', what: 'changed rules.txt despite DMD-1', why: 'the brief asked' },
      ],
    },
  });
  writeFileSync(
    join(specDir, 'events.jsonl'),
    doneTask('D-1', 10, 0.3, completed).replace('abcdef1234', sha),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('gatherReviewContext', () => {
  it('collects the config, briefs, commit, mentioned diffs, decisions and next ids', async () => {
    const config = loadConfig(dir);
    const { inputs, archived } = loadRunHistory(dir, config, ['demo']);
    const context = await gatherReviewContext({
      repoRoot: dir,
      config,
      inputs,
      archived,
      entries: deviationEntries(inputs),
      run,
    });

    expect(context.config).toContain('"verify"');
    expect(context.specs).toHaveLength(1);
    const [spec] = context.specs;
    expect(spec).toMatchObject({
      name: 'demo',
      title: 'Demo',
      location: {
        kind: 'live',
        files: 'specrun/specs/demo',
        worktree: null,
        branch: 'specrun/demo',
        merged: null,
      },
      taskPrompt: 'Run {TASK} carefully.\n',
      readmePath: 'specrun/specs/demo/README.md',
      decisions: ['| DMD-1 | Rules | Never touch X.  |'],
      lastRow: { decision: 6, question: 10 },
      next: { task: 'D-3', decision: 'DMD-3', question: 'Q2' },
    });
    const [task] = spec?.tasks ?? [];
    expect(task).toMatchObject({
      id: 'D-1',
      title: 'First',
      briefPath: 'specrun/specs/demo/tasks/D-1.md',
      brief: '# D-1\n',
    });
    expect(task?.commit?.message).toBe('feat: rules (D-1)\n\nChanged the rules.');
    expect(task?.commit?.files).toEqual(['+1 −0 src/other.txt', '+1 −0 src/rules.txt']);
    // Only the file a deviation names gets its diff.
    expect(task?.commit?.diffs.map((d) => d.path)).toEqual(['src/rules.txt']);
    expect(task?.commit?.diffs[0]?.diff).toContain('+allow all');
  });
});

describe('readmeFacts', () => {
  it('takes the prefix of the longest decision log and copes with a README without tables', () => {
    const readme = [
      '| SRD-40 | Quoted from specrun |',
      '| TRD-1 | a |',
      '| TRD-2 | b |',
      '| TRD-3 | c |',
    ].join('\n');
    expect(readmeFacts(readme, new Set(['SRD-40'])).next.decision).toBe('TRD-4');
    expect(readmeFacts(readme, new Set(['SRD-40'])).decisions).toEqual([
      '| SRD-40 | Quoted from specrun |',
    ]);
    expect(readmeFacts(null, new Set())).toEqual({
      decisions: [],
      lastRow: { decision: null, question: null },
      next: { decision: null, question: null },
    });
  });
});
