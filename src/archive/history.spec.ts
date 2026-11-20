import { describe, expect, it } from 'vitest';
import { eventLine } from '../../test/fixtures/specRepo.js';
import { HistorySchema, archivedVerify } from './history.js';
import type { Git } from '../git/git.js';

const history = (verify: unknown = undefined) =>
  HistorySchema.parse({
    version: 1,
    spec: 'old',
    title: 'Old',
    archivedAt: '2026-01-01T09:00:00.000Z',
    commit: 'abc1234',
    samples: [],
    deviations: [],
    ...(verify === undefined ? {} : { verify }),
  });

const ROUND = eventLine({
  t: 'verify.finished',
  task: 'OLD-1',
  round: 0,
  ok: true,
  durationMs: 2000,
  steps: [{ name: 'test', ok: true, durationMs: 2000 }],
  log: 'verify.log',
});

function fakeGit(files: Record<string, string>): Pick<Git, 'listFiles' | 'showFile'> {
  return {
    listFiles: () => Promise.resolve(Object.keys(files)),
    showFile: (_ref, path) => Promise.resolve(files[path] ?? null),
  };
}

describe('archivedVerify', () => {
  it('reads the run log from git where the spec folder was at the archive commit', async () => {
    const git = fakeGit({
      'lorem/archive/old/events.jsonl': 'not this one',
      'lorem/old/events.jsonl': ROUND,
    });
    expect(await archivedVerify(history(), git)).toMatchObject({ runs: 1, sumMs: 2000 });
  });

  it('prefers the summary kept in history.json', async () => {
    const kept = {
      runs: 3,
      failed: 0,
      sumMs: 1,
      p50Ms: 1,
      p90Ms: 1,
      maxMs: 1,
      sessionMs: 1,
      steps: [],
    };
    expect(await archivedVerify(history(kept), fakeGit({}))).toEqual(kept);
  });

  it('gives null when git has no log or fails', async () => {
    expect(await archivedVerify(history(), fakeGit({}))).toBeNull();
    const failing = { ...fakeGit({}), listFiles: () => Promise.reject(new Error('shallow')) };
    expect(await archivedVerify(history(), failing)).toBeNull();
  });
});
