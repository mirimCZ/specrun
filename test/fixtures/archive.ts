import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import type { HistorySchema } from '../../src/archive/history.js';

/** `docs/archive/<spec>/history.json` with one done task `<prefix>-1` and the given deviations. */
export function writeArchivedHistory(
  root: string,
  spec: string,
  // As written to disk: entries may lack `reviewed`, like history.json files from before reviews.
  deviations: z.input<typeof HistorySchema>['deviations'] = [],
): void {
  const dir = join(root, 'docs', 'archive', spec);
  mkdirSync(dir, { recursive: true });
  const history: z.input<typeof HistorySchema> = {
    version: 1,
    spec,
    title: spec,
    archivedAt: '2026-01-01T09:00:00.000Z',
    commit: 'abcdef1234',
    samples: [
      {
        spec,
        task: 'OLD-1',
        model: 'strong',
        size: 'L',
        turns: 50,
        costUsd: 2,
        peakContext: 90_000,
        sessions: 1,
        verifyRounds: 1,
        deviations: deviations.length,
        budgetExceeded: false,
      },
    ],
    deviations,
  };
  writeFileSync(join(dir, 'history.json'), JSON.stringify(history));
}
