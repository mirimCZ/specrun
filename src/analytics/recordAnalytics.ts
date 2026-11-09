import { readFileSync } from 'node:fs';
import type { SpecrunEvent } from '../events/eventSchema.js';
import type { EventStore } from '../events/eventStore.js';
import { readTranscript } from '../session/transcript.js';
import { analyzeSession } from './analyzeSession.js';
import { ANALYZER_VERSION } from './metricsSchema.js';
import { parseReadFirst } from './readFirst.js';

export interface RecordAnalyticsInput {
  store: Pick<EventStore, 'append'>;
  transcriptFile: string;
  task: string;
  sessionId: string;
  segment: number;
  /** Why the segment started; `verify-fix` makes every turn a fix turn. */
  reason: string;
  briefPath: string;
  testPatterns?: readonly string[];
}

/** Reads the transcript, analyzes it and appends the `analytics.session` event; throws on failure. */
export function recordAnalytics(input: RecordAnalyticsInput): SpecrunEvent {
  const messages = readTranscript(input.transcriptFile);
  let readFirst: string[] | null;
  try {
    readFirst = parseReadFirst(readFileSync(input.briefPath, 'utf8'));
  } catch {
    // A missing brief only costs the adherence section.
    readFirst = null;
  }
  const metrics = analyzeSession(messages, {
    readFirst,
    ...(input.testPatterns === undefined ? {} : { testPatterns: input.testPatterns }),
    fixFromTurn: input.reason === 'verify-fix' ? 1 : Number.POSITIVE_INFINITY,
  });
  return input.store.append({
    t: 'analytics.session',
    task: input.task,
    sessionId: input.sessionId,
    segment: input.segment,
    analyzerVersion: ANALYZER_VERSION,
    metrics,
  });
}
