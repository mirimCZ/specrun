import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { createFakeClock, type FakeClock } from '../../test/fakes/fakeClock.js';
import { createFakeSession, type FakeSegment } from '../../test/fakes/fakeSession.js';
import { ANALYZER_VERSION } from '../analytics/metricsSchema.js';
import { ConfigSchema, type Config } from '../config/configSchema.js';
import type { EventOf, EventType, SpecrunEvent } from '../events/eventSchema.js';
import { readEvents } from '../events/eventStore.js';
import type { UsageSnapshot } from '../limits/usage.js';
import { runCommand } from '../process/run.js';
import { nullReporter, type RunReporter } from './reporter.js';
import { runSpec, SNAPSHOT_MAX_AGE_MS, type RunAccount, type RunSpecOptions } from './runSpec.js';
import { createStopRequest, type StopRequest } from './stopRequest.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const START = new Date('2026-11-09T10:00:00.000Z');
const HOUR = 3_600_000;

type TaskDef = { id: string; phase?: number; needs?: string[]; size?: 'S' | 'M' | 'L' };

let dir: string;
let repo: string;
let worktree: string;
let clock: FakeClock;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8' });

function setupRepo(tasks: TaskDef[]): void {
  const specDir = join(repo, 'specrun', 'specs', 'demo');
  mkdirSync(join(specDir, 'tasks'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), '.specrun/\n');
  const spec = {
    title: 'Demo',
    tasks: tasks.map((t) => ({
      id: t.id,
      title: `Task ${t.id}`,
      phase: t.phase ?? 1,
      needs: t.needs ?? [],
      model: 'default',
      size: t.size ?? 'M',
    })),
  };
  writeFileSync(join(specDir, 'tasks.yaml'), stringify(spec));
  for (const t of tasks) writeFileSync(join(specDir, 'tasks', `${t.id}.md`), `# ${t.id} brief\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
}

function makeConfig(overrides: Record<string, unknown> = {}): Config {
  return ConfigSchema.parse({
    verify: [{ name: 'check', command: 'true' }],
    transcriptsDir: join(dir, 'transcripts'),
    ...overrides,
  });
}

function snapshot(sessionLeft: number, weeklyLeft = 80, resetsInMs = HOUR): UsageSnapshot {
  const resetsAt = new Date(clock.now().getTime() + resetsInMs);
  return {
    session: { leftPercent: sessionLeft, resetsAt },
    weekly: { leftPercent: weeklyLeft, resetsAt: new Date(resetsAt.getTime() + 24 * HOUR) },
    source: 'probe',
    at: clock.now(),
    rejected: false,
  };
}

interface Harness {
  config?: Config;
  segments: FakeSegment[];
  probes?: UsageSnapshot[];
  options?: Partial<RunSpecOptions>;
  pid?: number;
  isAlive?: (pid: number) => boolean;
  probeUsage?: () => Promise<UsageSnapshot | null>;
  /** Replaces the `default` account built from `probeUsage` / `probes`. */
  accounts?: [RunAccount, ...RunAccount[]];
  controller?: AbortController;
  reporter?: RunReporter;
  stop?: StopRequest;
}

async function start(h: Harness) {
  const session = createFakeSession(h.segments, { gitEnv: env });
  const probes = [...(h.probes ?? [])];
  const config = h.config ?? makeConfig();
  const implicit: RunAccount = {
    name: 'default',
    limits: {
      sessionMinLeft: config.limits.sessionMinLeft,
      weeklyMinLeft: config.limits.weeklyMinLeft,
    },
    env: null,
    probe: h.probeUsage ?? (() => Promise.resolve(probes.shift() ?? null)),
  };
  const result = await runSpec(
    { spec: 'demo', base: 'main', retryBlocked: false, workspace: 'own', ...h.options },
    {
      repoRoot: repo,
      config,
      session,
      run: (cmd, args, opts) => runCommand(cmd, args, { ...opts, env }),
      clock,
      accounts: h.accounts ?? [implicit],
      reporter: h.reporter ?? nullReporter,
      signal: (h.controller ?? new AbortController()).signal,
      ...(h.stop === undefined ? {} : { stop: h.stop }),
      version: '0.0.0-test',
      ...(h.pid === undefined ? {} : { pid: h.pid }),
      ...(h.isAlive === undefined ? {} : { isAlive: h.isAlive }),
    },
  );
  return { result, session };
}

function events(): SpecrunEvent[] {
  return readEvents(join(worktree, 'specrun', 'specs', 'demo', 'events.jsonl')).events;
}

function ofType<T extends EventType>(t: T): EventOf<T>[] {
  return events().filter((e): e is EventOf<T> => e.t === t);
}

/** Subjects of the spec branch's commits since main, oldest first. */
function subjects(): string[] {
  return git(repo, 'log', '--reverse', '--format=%s', 'main..specrun/demo')
    .split('\n')
    .filter((line) => line !== '');
}

function commitOf(task: string): string {
  const commit = ofType('task.committed').find((e) => e.task === task)?.commit;
  if (commit === undefined) throw new Error(`${task} not committed`);
  return commit;
}

const filesIn = (sha: string): string[] =>
  git(repo, 'show', '--name-only', '--format=', sha).trim().split('\n');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  worktree = join(repo, '.specrun', 'worktrees', 'demo');
  clock = createFakeClock(START);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runSpec', () => {
  it('runs dependent tasks in order and commits each with events and PROGRESS.md', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }]);
    const { result, session } = await start({
      segments: [
        {
          edits: { 'one.txt': '1\n' },
          payload: { commitMessage: 'feat: one', notes: ['one.txt exports ONE'] },
        },
        { edits: { 'two.txt': '2\n' }, payload: { commitMessage: 'feat: two' } },
      ],
    });

    expect(result).toEqual({ exitCode: 0, reason: 'done' });
    expect(subjects()).toEqual([
      'feat: one (A-1)',
      'feat: two (A-2)',
      'chore(specrun): demo run log',
    ]);
    const first = commitOf('A-1');
    expect(git(repo, 'log', '-1', '--format=%B', first)).toContain(
      'Specrun-Task: A-1\nSpecrun-Session: session-1',
    );
    expect(filesIn(first)).toEqual([
      'one.txt',
      'specrun/specs/demo/PROGRESS.md',
      'specrun/specs/demo/events.jsonl',
    ]);
    expect(git(repo, 'show', `${first}:specrun/specs/demo/PROGRESS.md`)).toMatch(
      /\| A-1 +\|.*\| done /,
    );
    expect(filesIn(commitOf('A-2'))).toContain('two.txt');
    expect(session.inputs[1]?.prompt).toContain('one.txt exports ONE');
    expect(session.inputs[1]?.resumeSessionId).toBeNull();
    expect(git(worktree, 'status', '--porcelain')).toBe('');
    expect(ofType('run.finished').map((e) => e.reason)).toEqual(['done']);
    expect(ofType('verify.finished').map((e) => e.ok)).toEqual([true, true]);
  });

  it('records an analytics.session event after each session.finished', async () => {
    setupRepo([{ id: 'A-1' }]);
    await start({
      segments: [{ tools: [{ name: 'Read', input: { file_path: '/x/a.ts' } }] }],
    });
    const types = events()
      .map((e) => e.t)
      .filter((t) => t === 'session.finished' || t === 'analytics.session');
    expect(types).toEqual(['session.finished', 'analytics.session']);
    expect(ofType('analytics.session')).toMatchObject([
      { task: 'A-1', sessionId: 'session-1', segment: 0, analyzerVersion: ANALYZER_VERSION },
    ]);
  });

  it('only logs when the transcript is broken', async () => {
    setupRepo([{ id: 'A-1' }]);
    const logs: string[] = [];
    const { result } = await start({
      segments: [{ transcript: 'broken' }],
      reporter: { ...nullReporter, log: (_level, message) => void logs.push(message) },
    });
    expect(result.reason).toBe('done');
    expect(ofType('analytics.session')).toHaveLength(0);
    expect(logs.some((m) => m.includes('analytics for A-1 failed'))).toBe(true);
  });

  it('reports the phases and the plan, and warns once while the usage probe fails', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }]);
    const seen: string[] = [];
    const { result } = await start({
      segments: [{ edits: { 'one.txt': '1' } }, { edits: { 'two.txt': '2' } }],
      reporter: {
        ...nullReporter,
        plan: ({ spec }) => void seen.push(`plan ${spec.tasks.map((t) => t.id).join(',')}`),
        phase: (phase) =>
          void seen.push(
            phase.kind === 'verify-step'
              ? `${phase.kind} ${phase.finished.name} → ${phase.next ?? '-'}`
              : 'task' in phase
                ? `${phase.kind} ${phase.task}`
                : phase.kind,
          ),
        log: (level, message) => void seen.push(`${level}: ${message}`),
      },
    });

    expect(result.reason).toBe('done');
    expect(seen).toEqual([
      'worktree',
      'plan A-1,A-2',
      'usage',
      'warn: usage probe failed — running without limit data',
      'agent A-1',
      'verify A-1',
      'verify-step check → -',
      'commit A-1',
      'usage',
      'agent A-2',
      'verify A-2',
      'verify-step check → -',
      'commit A-2',
    ]);
  });

  it('adds the verifyFinal steps only to the last task', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }]);
    const { result } = await start({
      config: makeConfig({ verifyFinal: [{ name: 'all', command: 'true' }] }),
      segments: [{ edits: { 'one.txt': '1' } }, { edits: { 'two.txt': '2' } }],
    });
    expect(result.reason).toBe('done');
    expect(
      ofType('verify.finished').map((e) => [e.task, e.steps.map((step) => step.name)]),
    ).toEqual([
      ['A-1', ['check']],
      ['A-2', ['check', 'all']],
    ]);
  });

  it('resumes the same session with the failure summary when verify is red, then commits', async () => {
    setupRepo([{ id: 'A-1' }]);
    const counter = join(dir, 'count');
    const check = `n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${counter}"; echo "Error: round $n"; [ $n -ge 2 ]`;
    const { result, session } = await start({
      config: makeConfig({ verify: [{ name: 'check', command: check }] }),
      segments: [{ edits: { 'a.txt': 'a' } }, {}],
    });

    expect(result.exitCode).toBe(0);
    expect(ofType('session.started').map((e) => e.reason)).toEqual(['start', 'verify-fix']);
    expect(session.inputs[1]?.resumeSessionId).toBe('session-1');
    expect(session.inputs[1]?.previous?.turns).toBe(5);
    expect(session.inputs[1]?.prompt).toContain('fix round 1 of 2');
    expect(session.inputs[1]?.prompt).toContain('Error: round 1');
    expect(ofType('verify.finished').map((e) => [e.round, e.ok])).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(ofType('session.started').map((e) => e.segment)).toEqual([0, 1]);
    expect(subjects()).toEqual(['feat: implement (A-1)', 'chore(specrun): demo run log']);
  });

  it('blocks and parks a task that stays red, skips its dependents and runs the rest', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }, { id: 'A-3' }]);
    const { result, session } = await start({
      config: makeConfig({
        verifyFixRounds: 1,
        verify: [{ name: 'check', command: 'test ! -f fail.txt' }],
      }),
      segments: [{ edits: { 'fail.txt': 'x' } }, {}, { edits: { 'ok.txt': 'ok' } }],
    });

    expect(result).toEqual({
      exitCode: 0,
      reason: 'done',
      message: 'nothing runnable: A-2 wait for blocked tasks',
    });
    expect(session.inputs).toHaveLength(3);
    const [blocked] = ofType('task.blocked');
    expect(blocked).toMatchObject({
      task: 'A-1',
      source: 'verify',
      parkedRef: 'refs/specrun/parked/demo/A-1',
    });
    expect(git(repo, 'show', 'refs/specrun/parked/demo/A-1:fail.txt')).toBe('x');
    expect(existsSync(join(worktree, 'fail.txt'))).toBe(false);
    expect(git(worktree, 'status', '--porcelain')).toBe('');
    expect(ofType('task.committed').map((e) => e.task)).toEqual(['A-3']);
    expect(ofType('session.started').map((e) => e.task)).toEqual(['A-1', 'A-1', 'A-3']);
    expect(filesIn(commitOf('A-3'))).not.toContain('fail.txt');
  });

  it('waits for the reset after a limit hit and resumes the same session', async () => {
    setupRepo([{ id: 'A-1' }]);
    const resetsAt = new Date(START.getTime() + HOUR);
    const { result, session } = await start({
      segments: [{ outcome: 'limit', toolCall: null, limitResetsAt: resetsAt }, {}],
    });

    expect(result.exitCode).toBe(0);
    const [wait] = ofType('limit.wait');
    expect(wait).toMatchObject({
      task: 'A-1',
      reason: 'limit-hit',
      until: new Date(resetsAt.getTime() + 60_000).toISOString(),
    });
    expect(clock.now().getTime()).toBeGreaterThanOrEqual(resetsAt.getTime() + 60_000);
    expect(ofType('session.started').map((e) => [e.reason, e.sessionId])).toEqual([
      ['start', null],
      ['limit-resume', 'session-1'],
    ]);
    expect(session.inputs[1]?.resumeSessionId).toBe('session-1');
  });

  it('runs in the main checkout on the spec branch with "worktree": false', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { result, session } = await start({
      config: makeConfig({ worktree: false, setup: 'touch setup-ran' }),
      segments: [{ edits: { 'one.txt': '1\n' }, payload: { commitMessage: 'feat: one' } }],
    });

    expect(result).toEqual({ exitCode: 0, reason: 'done' });
    expect(session.inputs[0]?.cwd).toBe(repo);
    expect(existsSync(worktree)).toBe(false);
    expect(existsSync(join(repo, 'setup-ran'))).toBe(false);
    expect(git(repo, 'branch', '--show-current').trim()).toBe('specrun/demo');
    expect(subjects()).toEqual(['feat: one (A-1)', 'chore(specrun): demo run log']);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(repo, '.specrun', 'locks', '.checkout.lock'))).toBe(false);
  });

  it('refuses to switch a dirty main checkout', async () => {
    setupRepo([{ id: 'A-1' }]);
    writeFileSync(join(repo, 'mine.txt'), 'uncommitted\n');
    await expect(
      start({ config: makeConfig({ worktree: false }), segments: [] }),
    ).rejects.toMatchObject({ code: 'checkout-dirty' });
    expect(git(repo, 'branch', '--show-current').trim()).toBe('main');
  });

  it('finishes the running task on a stop request and starts no other', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2' }]);
    const stop = createStopRequest();
    const { result, session } = await start({
      segments: [{ edits: { 'one.txt': '1' } }, {}],
      stop,
      reporter: {
        ...nullReporter,
        event: (event) => {
          if (event.t === 'session.started') stop.request();
        },
      },
    });

    expect(result).toEqual({ exitCode: 0, reason: 'stopped' });
    expect(session.inputs).toHaveLength(1);
    expect(ofType('task.committed').map((e) => e.task)).toEqual(['A-1']);
    expect(ofType('run.finished').map((e) => e.reason)).toEqual(['stopped']);
  });

  it('ends a limit wait at once on a stop request', async () => {
    setupRepo([{ id: 'A-1' }]);
    const stop = createStopRequest();
    const { result, session } = await start({
      probes: [snapshot(10, 80, HOUR)],
      segments: [{}],
      stop,
      reporter: { ...nullReporter, waiting: () => stop.request() },
    });

    expect(result).toEqual({
      exitCode: 0,
      reason: 'stopped',
      message: 'stopped while waiting for limits; A-1 continues on the next run',
    });
    expect(session.inputs).toHaveLength(0);
    expect(clock.now().getTime()).toBeLessThan(START.getTime() + HOUR);
  });

  it('waits before a task while the session window is low', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { result } = await start({
      probes: [snapshot(10, 80, HOUR), snapshot(90)],
      segments: [{}],
    });

    expect(result.exitCode).toBe(0);
    expect(ofType('limit.wait')).toMatchObject([{ reason: 'session-low', task: 'A-1' }]);
    expect(ofType('usage.snapshot').map((e) => e.sessionLeft)).toEqual([10, 90]);
    const waitedUntil = ofType('session.started')[0]?.at;
    expect(waitedUntil).toBe(new Date(START.getTime() + HOUR + 60_000).toISOString());
  });

  it('stops with exit 75 when the weekly window is low', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { result, session } = await start({ probes: [snapshot(90, 2)], segments: [{}] });

    expect(result).toMatchObject({ exitCode: 75, reason: 'paused-weekly' });
    expect(session.inputs).toHaveLength(0);
    expect(ofType('run.finished').map((e) => e.reason)).toEqual(['paused-weekly']);
  });

  it('nudges once after a session without a tool call, then blocks (protocol)', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { session } = await start({
      segments: [
        { outcome: 'no-call', toolCall: null },
        { outcome: 'no-call', toolCall: null },
      ],
    });

    expect(ofType('session.started').map((e) => e.reason)).toEqual(['start', 'nudge']);
    expect(session.inputs[1]?.prompt).toContain('nothing was recorded');
    expect(ofType('task.blocked')).toMatchObject([{ task: 'A-1', source: 'protocol' }]);
  });

  it('blocks with the agent kind on block_task', async () => {
    setupRepo([{ id: 'A-1' }]);
    await start({ segments: [{ outcome: 'blocked' }] });
    expect(ofType('task.blocked')).toMatchObject([
      { source: 'agent', kind: 'other', reason: 'cannot do it' },
    ]);
    expect(ofType('task.blocked')[0]).not.toHaveProperty('parkedRef');
  });

  it('undoes an agent commit with a soft reset and records the violation', async () => {
    setupRepo([{ id: 'A-1' }]);
    await start({ segments: [{ edits: { 'x.txt': 'x' }, commit: 'agent did it' }] });

    expect(ofType('protocol.violation')).toMatchObject([{ task: 'A-1', kind: 'agent-commit' }]);
    expect(subjects()).toEqual(['feat: implement (A-1)', 'chore(specrun): demo run log']);
    expect(filesIn(commitOf('A-1'))).toContain('x.txt');
  });

  it('resumes a task interrupted by an earlier run with crash-resume', async () => {
    setupRepo([{ id: 'A-1' }]);
    const first = await start({
      segments: [{ outcome: 'interrupted', toolCall: null, edits: { 'half.txt': 'half' } }],
    });
    expect(first.result).toEqual({ exitCode: 130, reason: 'interrupted' });
    expect(existsSync(join(worktree, 'half.txt'))).toBe(true);

    const second = await start({ segments: [{}] });
    expect(second.result.exitCode).toBe(0);
    const input = second.session.inputs[0];
    expect(input?.resumeSessionId).toBe('session-1');
    expect(input?.previous?.turns).toBe(5);
    expect(input?.prompt).toContain('was interrupted');
    const started = ofType('session.started').at(-1);
    expect(started).toMatchObject({ reason: 'crash-resume', segment: 1, attempt: 1 });
    expect(filesIn(commitOf('A-1'))).toContain('half.txt');
  });

  it('runs every phase without stopping, the lowest phase first', async () => {
    setupRepo([{ id: 'B-1', phase: 2 }, { id: 'A-1' }]);
    const { result } = await start({ segments: [{}, {}] });
    expect(result).toEqual({ exitCode: 0, reason: 'done' });
    expect(ofType('task.committed').map((e) => e.task)).toEqual(['A-1', 'B-1']);
  });

  it('runs a later phase while the earlier one waits for a blocked task', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }, { id: 'B-1', phase: 2 }]);
    const { result } = await start({ segments: [{ outcome: 'blocked' }, {}] });
    expect(result).toMatchObject({
      reason: 'done',
      message: 'nothing runnable: A-2 wait for blocked tasks',
    });
    expect(ofType('task.committed').map((e) => e.task)).toEqual(['B-1']);
  });

  it('records budget.exceeded when a task goes over its size', async () => {
    setupRepo([{ id: 'A-1', size: 'S' }]);
    await start({ segments: [{ stats: { turns: 30, costUsd: 0.2 } }] });
    expect(ofType('budget.exceeded')).toMatchObject([
      { task: 'A-1', size: 'S', turns: 30, costUsd: 0.2, limit: { turns: 25, usd: 0.6 } },
    ]);
  });

  it('refuses a lock held by a live pid and takes over a stale one', async () => {
    setupRepo([{ id: 'A-1' }]);
    const lock = join(repo, '.specrun', 'locks', 'demo.lock');
    mkdirSync(join(repo, '.specrun', 'locks'), { recursive: true });
    writeFileSync(lock, '4242\n');

    await expect(start({ segments: [{}], pid: 1000, isAlive: () => true })).rejects.toMatchObject({
      code: 'locked',
    });
    const { result } = await start({ segments: [{}], pid: 1000, isAlive: () => false });
    expect(result.exitCode).toBe(0);
    expect(existsSync(lock)).toBe(false);
  });

  it('runs only the filtered task and fails on a task that is not runnable', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }, { id: 'A-3' }]);
    const failed = await start({ segments: [], options: { taskFilter: 'A-2' } });
    expect(failed.result).toEqual({
      exitCode: 1,
      reason: 'failed',
      message: 'Task A-2 is not runnable: todo, waits for A-1',
    });

    const { result } = await start({ segments: [{}], options: { taskFilter: 'A-3' } });
    expect(result.reason).toBe('done');
    expect(ofType('task.committed').map((e) => e.task)).toEqual(['A-3']);
  });

  it('ends with run.finished failed and exit 1 when a dependency throws', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { result } = await start({
      segments: [{}],
      probeUsage: () => Promise.reject(new Error('probe exploded')),
    });
    expect(result).toEqual({ exitCode: 1, reason: 'failed', message: 'probe exploded' });
    expect(ofType('run.finished')).toMatchObject([{ reason: 'failed', message: 'probe exploded' }]);
    expect(existsSync(join(repo, '.specrun', 'locks', 'demo.lock'))).toBe(false);
  });

  it('exits 130 when aborted during a wait', async () => {
    setupRepo([{ id: 'A-1' }]);
    const controller = new AbortController();
    const { result, session } = await start({
      segments: [{}],
      controller,
      probeUsage: () => {
        controller.abort();
        return Promise.resolve(snapshot(5));
      },
    });
    expect(result).toEqual({ exitCode: 130, reason: 'interrupted' });
    expect(session.inputs).toHaveLength(0);
    expect(subjects()).toEqual(['chore(specrun): demo run log']);
  });
});

describe('runSpec with several accounts', () => {
  const LIMITS = { sessionMinLeft: 15, weeklyMinLeft: 5 };

  /** `snapshots` are returned in order, then the last one again. */
  function account(name: string, snapshots: UsageSnapshot[] = []): RunAccount {
    const queue = [...snapshots];
    return {
      name,
      limits: LIMITS,
      env: { CLAUDE_CODE_OAUTH_TOKEN: `lorem-token-${name}` },
      probe: () => Promise.resolve(queue.length > 1 ? (queue.shift() ?? null) : (queue[0] ?? null)),
    };
  }

  const accountsOf = (t: EventType): (string | undefined)[] =>
    events()
      .filter((e) => e.t === t)
      .map((e) => ('account' in e ? e.account : undefined));

  it('runs on the fallback when the priority account is weekly-low', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { result, session } = await start({
      accounts: [account('p', [snapshot(90, 2)]), account('f', [snapshot(90)])],
      segments: [{}],
    });

    expect(result).toEqual({ exitCode: 0, reason: 'done' });
    expect(session.inputs[0]?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'lorem-token-f' });
    expect(ofType('account.switched')).toMatchObject([
      { task: 'A-1', from: 'p', to: 'f', reason: 'weekly-low' },
    ]);
    expect(accountsOf('session.started')).toEqual(['f']);
    expect(accountsOf('session.finished')).toEqual(['f']);
    expect(accountsOf('usage.snapshot')).toEqual(['p', 'f']);
  });

  it('waits for the priority account without burn when its session window is low', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { result, session } = await start({
      accounts: [
        account('p', [snapshot(10, 80, HOUR), snapshot(90)]),
        account('f', [snapshot(90)]),
      ],
      segments: [{}],
    });

    expect(result.exitCode).toBe(0);
    expect(ofType('limit.wait')).toMatchObject([
      { task: 'A-1', account: 'p', reason: 'session-low' },
    ]);
    expect(ofType('account.switched')).toEqual([]);
    expect(accountsOf('session.started')).toEqual(['p']);
    expect(session.inputs[0]?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'lorem-token-p' });
  });

  it('runs on the fallback with burn when the priority session window is low', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { result, session } = await start({
      accounts: [account('p', [snapshot(10)]), account('f', [snapshot(90)])],
      options: { burn: true },
      segments: [{}],
    });

    expect(result.exitCode).toBe(0);
    expect(ofType('limit.wait')).toEqual([]);
    expect(ofType('account.switched')).toMatchObject([
      { from: 'p', to: 'f', reason: 'session-low' },
    ]);
    expect(session.inputs[0]?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'lorem-token-f' });
  });

  it('resumes the same session on the fallback after a limit hit with burn', async () => {
    setupRepo([{ id: 'A-1' }]);
    const resetsAt = new Date(START.getTime() + HOUR);
    const { result, session } = await start({
      accounts: [account('p', [snapshot(90)]), account('f', [snapshot(90)])],
      options: { burn: true },
      segments: [{ outcome: 'limit', toolCall: null, limitResetsAt: resetsAt }, {}],
    });

    expect(result.exitCode).toBe(0);
    expect(ofType('limit.wait')).toEqual([]);
    expect(clock.now().getTime()).toBeLessThan(resetsAt.getTime());
    expect(ofType('session.started').map((e) => [e.reason, e.sessionId, e.account])).toEqual([
      ['start', null, 'p'],
      ['limit-resume', 'session-1', 'f'],
    ]);
    expect(ofType('account.switched')).toMatchObject([{ from: 'p', to: 'f', reason: 'limit-hit' }]);
    expect(session.inputs[1]?.resumeSessionId).toBe('session-1');
    expect(session.inputs[1]?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'lorem-token-f' });
  });

  it('waits for the reset and resumes on the same account after a limit hit without burn', async () => {
    setupRepo([{ id: 'A-1' }]);
    const resetsAt = new Date(START.getTime() + HOUR);
    const { result } = await start({
      accounts: [account('p', [snapshot(90)]), account('f', [snapshot(90)])],
      segments: [{ outcome: 'limit', toolCall: null, limitResetsAt: resetsAt }, {}],
    });

    expect(result.exitCode).toBe(0);
    expect(ofType('limit.wait')).toMatchObject([
      {
        account: 'p',
        reason: 'limit-hit',
        until: new Date(resetsAt.getTime() + 60_000).toISOString(),
      },
    ]);
    expect(ofType('session.started').map((e) => [e.reason, e.sessionId, e.account])).toEqual([
      ['start', null, 'p'],
      ['limit-resume', 'session-1', 'p'],
    ]);
    expect(ofType('account.switched')).toEqual([]);
  });

  it('keeps the next task on the fallback while the priority account is blocked', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }]);
    const resetsAt = new Date(START.getTime() + HOUR);
    const { result } = await start({
      // The fallback's snapshot ages out during the run; the priority one recovers after the wait.
      accounts: [account('p', [snapshot(90), snapshot(90)]), account('f', [snapshot(90)])],
      options: { burn: true },
      segments: [
        { outcome: 'limit', toolCall: null, limitResetsAt: resetsAt, edits: { 'one.txt': '1' } },
        {},
        { edits: { 'two.txt': '2' } },
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(ofType('session.started').map((e) => [e.task, e.account])).toEqual([
      ['A-1', 'p'],
      ['A-1', 'f'],
      ['A-2', 'f'],
    ]);
    // p is still blocked when A-2 starts, so the run stays on f: no switch back yet.
    expect(ofType('account.switched').map((e) => [e.task, e.from, e.to, e.reason])).toEqual([
      ['A-1', 'p', 'f', 'limit-hit'],
    ]);
  });

  it('goes back to the priority account with reason priority after a task on the fallback', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }]);
    const { result } = await start({
      // p is session-low at first; its next probe (after the snapshot went stale) is fine again.
      accounts: [account('p', [snapshot(10), snapshot(90)]), account('f', [snapshot(90)])],
      options: { burn: true },
      segments: [{ edits: { 'one.txt': '1' } }, { edits: { 'two.txt': '2' } }],
      reporter: {
        ...nullReporter,
        // Age the snapshots so the next task's pause check probes again.
        event: (event) => {
          if (event.t === 'session.finished') clock.advance(SNAPSHOT_MAX_AGE_MS + 1);
        },
      },
    });

    expect(result.exitCode).toBe(0);
    expect(ofType('session.started').map((e) => [e.task, e.account])).toEqual([
      ['A-1', 'f'],
      ['A-2', 'p'],
    ]);
    expect(ofType('account.switched').map((e) => [e.task, e.from, e.to, e.reason])).toEqual([
      ['A-1', 'p', 'f', 'session-low'],
      ['A-2', 'f', 'p', 'priority'],
    ]);
  });

  it('stops with exit 75 when every account is weekly-low', async () => {
    setupRepo([{ id: 'A-1' }]);
    const { result, session } = await start({
      accounts: [account('p', [snapshot(90, 2)]), account('f', [snapshot(90, 1)])],
      segments: [{}],
    });

    expect(result).toEqual({
      exitCode: 75,
      reason: 'paused-weekly',
      message: 'weekly usage left below the minimum on every account',
    });
    expect(session.inputs).toHaveLength(0);
  });

  it('warns once per failing account', async () => {
    setupRepo([{ id: 'A-1' }, { id: 'A-2', needs: ['A-1'] }]);
    const logs: string[] = [];
    await start({
      accounts: [account('p'), account('f', [snapshot(90)])],
      segments: [{ edits: { 'one.txt': '1' } }, { edits: { 'two.txt': '2' } }],
      reporter: { ...nullReporter, log: (_level, message) => void logs.push(message) },
    });

    expect(logs).toEqual(['usage probe failed for p — running without limit data']);
  });
});

describe('runSpec with the implicit account', () => {
  it('writes account default on every account-carrying event', async () => {
    setupRepo([{ id: 'A-1' }]);
    const resetsAt = new Date(START.getTime() + HOUR);
    await start({
      probes: [snapshot(90)],
      segments: [{ outcome: 'limit', toolCall: null, limitResetsAt: resetsAt }, {}],
    });

    const carrying = events().filter((e) =>
      ['session.started', 'session.finished', 'usage.snapshot', 'limit.wait'].includes(e.t),
    );
    expect(new Set(carrying.map((e) => e.t)).size).toBe(4);
    expect(carrying.every((e) => 'account' in e && e.account === 'default')).toBe(true);
    expect(ofType('account.switched')).toEqual([]);
  });
});
