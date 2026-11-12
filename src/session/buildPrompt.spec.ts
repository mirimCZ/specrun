import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteTaskPayload, SpecrunEvent } from '../events/eventSchema.js';
import { deriveState } from '../events/taskState.js';
import type { LoadedSpec } from '../spec/loadSpec.js';
import type { Spec, SpecTask } from '../spec/specSchema.js';
import { buildPrompt, loadProtocol } from './buildPrompt.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  mkdirSync(join(dir, 'tasks'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function task(id: string, needs: string[] = []): SpecTask {
  return { id, title: id, phase: 1, needs, model: 'default', size: 'S' };
}

const TASKS = [task('A-1'), task('A-2'), task('A-3', ['A-2', 'A-1'])];
const SPEC: Spec = { title: 'Demo', tasks: TASKS };

function loaded(taskPrompt: string | null): LoadedSpec {
  for (const { id } of TASKS) writeFileSync(join(dir, 'tasks', `${id}.md`), `# ${id} brief\n`);
  const taskPromptPath = join(dir, 'TASK_PROMPT.md');
  if (taskPrompt !== null) writeFileSync(taskPromptPath, taskPrompt);
  return {
    name: 'demo',
    dir,
    spec: SPEC,
    briefPath: (id) => join(dir, 'tasks', `${id}.md`),
    taskPromptPath: taskPrompt === null ? null : taskPromptPath,
  };
}

/** `task.completed` + `task.committed` for every given task, so they are `done`. */
function stateOf(completed: Record<string, CompleteTaskPayload>): ReturnType<typeof deriveState> {
  const base = { v: 1, at: '2026-11-09T10:00:00.000Z', runId: 'r' } as const;
  const events: SpecrunEvent[] = Object.entries(completed).flatMap(([id, payload]) => [
    { ...base, t: 'task.completed', task: id, sessionId: 's', payload },
    {
      ...base,
      t: 'task.committed',
      task: id,
      commit: 'abc',
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
    },
  ]);
  return deriveState(SPEC, events);
}

const PROTOCOL = '# Protocol\n\nDo it.\n';

describe('buildPrompt', () => {
  it('joins protocol, spec prompt, brief and dependency notes in order and counts their chars', () => {
    const spec = loaded('Implement {TASK} now. Again: {TASK}.\n');
    const state = stateOf({
      'A-1': {
        summary: 's',
        commitMessage: 'feat: a1',
        notes: ['a1 note'],
        deviations: [],
      },
      'A-2': {
        summary: 's',
        commitMessage: 'feat: a2',
        notes: ['a2 first', 'a2 second'],
        deviations: [
          {
            kind: 'ambiguity',
            decision: 'used X',
            what: 'chose X over Y',
            why: 'simpler',
            question: { text: 'X or Y?', options: ['X', 'Y', 'Z'], chosen: 'X' },
          },
          { kind: 'test-trap', what: 'timer leak', why: 'fake clock' },
        ],
      },
    });
    const { text, parts } = buildPrompt({ spec, task: TASKS[2]!, state, protocol: PROTOCOL });

    const specPart = 'Implement A-3 now. Again: A-3.';
    const brief = '# A-3 brief';
    const deps = [
      '## Implementation notes of A-2 (dependency)',
      '',
      '- a2 first',
      '- a2 second',
      '',
      'Deviations:',
      '',
      '- [ambiguity] used X: chose X over Y — simpler',
      '  - Q: X or Y? → X (over Y · Z)',
      '- [test-trap] timer leak — fake clock',
      '',
      '## Implementation notes of A-1 (dependency)',
      '',
      '- a1 note',
    ].join('\n');
    expect(text).toBe(['# Protocol\n\nDo it.', specPart, brief, deps].join('\n\n---\n\n') + '\n');
    expect(parts).toEqual({
      protocol: '# Protocol\n\nDo it.'.length,
      spec: specPart.length,
      brief: brief.length,
      deps: deps.length,
    });
  });

  it('leaves the spec part out without TASK_PROMPT.md', () => {
    const { text, parts } = buildPrompt({
      spec: loaded(null),
      task: TASKS[0]!,
      state: stateOf({}),
      protocol: PROTOCOL,
    });
    expect(text).toBe('# Protocol\n\nDo it.\n\n---\n\n# A-1 brief\n');
    expect(parts.spec).toBe(0);
    expect(parts.deps).toBe(0);
  });

  it('says so when a dependency has no recorded notes', () => {
    const state = stateOf({
      'A-2': { summary: 's', commitMessage: 'feat: a2', notes: [], deviations: [] },
    });
    const { text } = buildPrompt({
      spec: loaded(null),
      task: TASKS[2]!,
      state,
      protocol: PROTOCOL,
    });
    // A-2 completed with nothing to say, A-1 has no `task.completed` at all (e.g. set done manually).
    expect(text).toContain('## Implementation notes of A-2 (dependency)\n\nNo notes recorded.');
    expect(text).toContain('## Implementation notes of A-1 (dependency)\n\nNo notes recorded.');
  });

  it('renders deviations without notes', () => {
    const state = stateOf({
      'A-2': {
        summary: 's',
        commitMessage: 'feat: a2',
        notes: [],
        deviations: [{ kind: 'scope', what: 'skipped Z', why: 'out of scope' }],
      },
    });
    const { text } = buildPrompt({
      spec: loaded(null),
      task: TASKS[2]!,
      state,
      protocol: PROTOCOL,
    });
    expect(text).toContain(
      '## Implementation notes of A-2 (dependency)\n\nDeviations:\n\n- [scope] skipped Z — out of scope',
    );
  });
});

describe('loadProtocol', () => {
  it('reads the shipped protocol', () => {
    const protocol = loadProtocol();
    expect(protocol).toContain('complete_task');
    expect(protocol).toContain('block_task');
    expect(protocol.split('\n').length).toBeLessThanOrEqual(61);
  });
});
