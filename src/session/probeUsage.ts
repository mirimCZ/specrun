import { query as sdkQuery, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { systemClock, type Clock } from '../limits/clock.js';
import { fromUsageProbe, type UsageSnapshot } from '../limits/usage.js';

export const PROBE_TIMEOUT_MS = 15_000;

export type ProbeUsageDeps = {
  query?: typeof sdkQuery;
  cwd: string;
  clock?: Clock;
  timeoutMs?: number;
  /** Complete child env (e.g. an account token); left out to inherit `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
};

/**
 * Plan usage windows without spending a request: an idle streaming session asked for its usage
 * once the control handshake is done (spike: $0). Waits for `initializationResult()`, not the
 * `system:init` message: since SDK 0.3.x an idle session only sends that with the first prompt.
 * Experimental SDK API — any failure or a timeout → null.
 */
export async function probeUsage(deps: ProbeUsageDeps): Promise<UsageSnapshot | null> {
  const query = deps.query ?? sdkQuery;
  const clock = deps.clock ?? systemClock;
  const stop = new AbortController();
  // The prompt stays open without sending anything until the probe is done.
  async function* idle(): AsyncGenerator<SDKUserMessage, void> {
    await new Promise<void>((resolve) =>
      stop.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  }

  const session: { q: Query | null } = { q: null };
  async function probe(): Promise<UsageSnapshot | null> {
    const q = query({
      prompt: idle(),
      options: {
        cwd: deps.cwd,
        tools: [],
        settingSources: [],
        persistSession: false,
        ...(deps.env === undefined ? {} : { env: { ...deps.env } }),
      },
    });
    session.q = q;
    await q.initializationResult();
    const response = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
    return fromUsageProbe(response, clock.now());
  }

  const timeout = clock
    .sleep(deps.timeoutMs ?? PROBE_TIMEOUT_MS, stop.signal)
    .then(() => null)
    .catch(() => null);
  try {
    return await Promise.race([probe().catch(() => null), timeout]);
  } finally {
    stop.abort();
    try {
      session.q?.close();
    } catch {
      // Already closed.
    }
  }
}
