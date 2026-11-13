import { describe, expect, it } from 'vitest';
import type { SpecrunEvent } from '../events/eventSchema.js';
import { createFakeClock } from '../../test/fakes/fakeClock.js';
import { createLineReporter } from './lineReporter.js';

function setup(): {
  lines: string[];
  reporter: ReturnType<typeof createLineReporter>;
  advance: (ms: number) => void;
} {
  const lines: string[] = [];
  const clock = createFakeClock(new Date('2026-01-01T10:00:00.000Z'));
  const reporter = createLineReporter((text) => lines.push(text), {
    color: false,
    now: () => clock.now(),
  });
  return { lines, reporter, advance: (ms) => clock.advance(ms) };
}

const base = { v: 1, at: '2026-01-01T10:00:00.000Z', runId: 'r' } as const;
const asEvent = (event: object): SpecrunEvent => ({ ...base, ...event }) as SpecrunEvent;

describe('createLineReporter', () => {
  it('prints task finish with the summed session stats', () => {
    const { lines, reporter } = setup();
    for (const [turns, peak, cost] of [
      [30, 58_000, 0.3],
      [12, 40_000, 0.2],
    ] as const) {
      reporter.event(
        asEvent({
          t: 'session.finished',
          task: 'SR-1',
          sessionId: 's',
          segment: 0,
          outcome: 'completed',
          turns,
          peakContext: peak,
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          costUsd: cost,
          durationMs: 1,
        }),
      );
    }
    reporter.event(
      asEvent({
        t: 'task.committed',
        task: 'SR-1',
        commit: 'abcdef123456',
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
      }),
    );
    expect(lines.at(-1)).toContain('✔ SR-1 committed abcdef1 · 42 turns · peak 58k · $0.50');
  });

  it('prints verify results, blocks, waits and tool uses', () => {
    const { lines, reporter } = setup();
    reporter.event(
      asEvent({
        t: 'verify.finished',
        task: 'SR-1',
        round: 1,
        ok: false,
        durationMs: 1,
        steps: [{ name: 'test', ok: false, durationMs: 1 }],
        log: 'x',
      }),
    );
    reporter.event(asEvent({ t: 'task.blocked', task: 'SR-1', reason: 'no way', source: 'agent' }));
    reporter.event(
      asEvent({ t: 'limit.wait', reason: 'limit-hit', until: '2026-01-01T12:30:00.000Z' }),
    );
    reporter.activity({ task: 'SR-1', tool: 'Edit', detail: 'src/x.ts' });
    const text = lines.join('');
    expect(text).toContain('verify SR-1 round 1: failed (test)');
    expect(text).toContain('✖ SR-1 blocked (agent): no way');
    expect(text).toContain('waiting until');
    expect(text).toContain('🔧 Edit src/x.ts');
  });

  it('prints task titles, usage snapshots and the slow startup phases', () => {
    const { lines, reporter } = setup();
    reporter.plan({
      spec: {
        title: 'Demo',
        tasks: [{ id: 'SR-1', title: 'Schema', phase: 1, needs: [], model: 'default', size: 'S' }],
      },
      events: [],
    });
    reporter.phase({ kind: 'worktree', path: '.specrun/worktrees/demo' });
    reporter.phase({ kind: 'setup', command: 'npm ci' });
    reporter.phase({ kind: 'usage' });
    reporter.phase({ kind: 'agent', task: 'SR-1' });
    reporter.event(
      asEvent({
        t: 'usage.snapshot',
        sessionLeft: 90,
        sessionResetsAt: '2026-01-01T06:30:00.000Z',
        weeklyLeft: 63.4,
        weeklyResetsAt: null,
        source: 'probe',
      }),
    );
    reporter.event(
      asEvent({
        t: 'session.started',
        task: 'SR-1',
        sessionId: null,
        segment: 0,
        attempt: 1,
        model: 'opus',
        reason: 'start',
        prompt: { protocol: 1, spec: 1, brief: 1, deps: 0 },
      }),
    );
    const reset = new Date('2026-01-01T06:30:00.000Z');
    const hhmm = `${String(reset.getHours()).padStart(2, '0')}:${String(reset.getMinutes()).padStart(2, '0')}`;
    expect(lines.map((line) => line.slice(9))).toEqual([
      'creating worktree .specrun/worktrees/demo\n',
      'setup: npm ci\n',
      `usage: session 90 % left · resets ${hhmm} · weekly 63 % left\n`,
      '▶ SR-1 Schema (start, opus)\n',
    ]);
  });

  it('ignores events without a line and throttles waiting to every 10 minutes', () => {
    const { lines, reporter, advance } = setup();
    reporter.event(
      asEvent({
        t: 'manual.status',
        task: 'SR-1',
        status: 'done',
        reason: 'by hand',
      }),
    );
    expect(lines).toEqual([]);
    const until = new Date('2026-01-01T14:00:00.000Z');
    for (let tick = 0; tick < 25; tick += 1) {
      reporter.waiting({ until, reason: 'session-low' });
      advance(60_000);
    }
    expect(lines).toHaveLength(3);
  });
});
