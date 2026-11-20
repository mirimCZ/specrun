import { describe, expect, it } from 'vitest';
import type { SpecrunEvent } from '../events/eventSchema.js';
import { createEventFormatter } from './eventLines.js';

const base = { v: 1, at: '2026-01-01T10:00:00.000Z', runId: 'r' } as const;
const asEvent = (event: object): SpecrunEvent => ({ ...base, ...event }) as SpecrunEvent;
const text = (event: SpecrunEvent): string | undefined =>
  createEventFormatter()
    .event(event)
    ?.map((segment) => segment.text)
    .join('');

const started = {
  t: 'session.started',
  task: 'LO-1',
  sessionId: null,
  segment: 0,
  attempt: 1,
  model: 'opus',
  reason: 'start',
  prompt: { protocol: 1, spec: 1, brief: 1, deps: 0 },
};
const wait = { t: 'limit.wait', task: 'LO-1', reason: 'limit-hit', until: '2026-01-01T12:00:00Z' };
const usage = {
  t: 'usage.snapshot',
  sessionLeft: 90,
  sessionResetsAt: null,
  weeklyLeft: 63,
  weeklyResetsAt: null,
  source: 'probe',
};

describe('eventLines accounts', () => {
  it('labels lines of a non-default account', () => {
    expect(text(asEvent({ ...started, account: 'ipsum' }))).toBe('▶ LO-1 (start, opus) on ipsum');
    expect(text(asEvent({ ...wait, account: 'ipsum' }))).toMatch(/^⏳ ipsum waiting until /);
    expect(text(asEvent({ ...usage, account: 'ipsum' }))).toBe(
      'usage ipsum: session 90 % left · weekly 63 % left',
    );
  });

  it('prints a switch in yellow', () => {
    const segments = createEventFormatter().event(
      asEvent({
        t: 'account.switched',
        task: 'LO-1',
        from: 'default',
        to: 'ipsum',
        reason: 'limit-hit',
      }),
    );
    expect(segments).toEqual([
      { text: '⇄ LO-1 account default → ipsum (limit-hit)', tone: 'yellow' },
    ]);
  });

  it('renders events without an account or on default as before', () => {
    expect(text(asEvent(started))).toBe('▶ LO-1 (start, opus)');
    expect(text(asEvent({ ...started, account: 'default' }))).toBe('▶ LO-1 (start, opus)');
    expect(text(asEvent({ ...wait, account: 'default' }))).toMatch(/^⏳ waiting until /);
    expect(text(asEvent(wait))).toMatch(/^⏳ waiting until /);
    expect(text(asEvent({ ...usage, account: 'default' }))).toBe(
      'usage: session 90 % left · weekly 63 % left',
    );
    expect(text(asEvent(usage))).toBe('usage: session 90 % left · weekly 63 % left');
  });
});
