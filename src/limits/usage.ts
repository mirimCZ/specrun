import { z } from 'zod';

export type UsageWindow = { leftPercent: number; resetsAt: Date | null };

export type UsageSnapshot = {
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  source: 'event' | 'probe';
  at: Date;
  rejected: boolean;
};

// Both sources are parsed leniently (extra fields ignored, windows optional/nullable): the
// `unifiedWindows` shape is not part of the SDK types and may drift.
const EventWindowSchema = z.object({
  utilization: z.number().nullish(),
  resetsAt: z.number().nullish(),
});
const EventInfoSchema = z.object({
  status: z.string().nullish(),
  unifiedWindows: z
    .object({
      five_hour: EventWindowSchema.nullish(),
      seven_day: EventWindowSchema.nullish(),
    })
    .nullish(),
});

const ProbeWindowSchema = z.object({
  utilization: z.number().nullish(),
  resets_at: z.string().nullish(),
});
const ProbeSchema = z.object({
  rate_limits: z
    .object({
      five_hour: ProbeWindowSchema.nullish(),
      seven_day: ProbeWindowSchema.nullish(),
    })
    .nullish(),
});

function leftFrom(utilizationPercent: number): number {
  return Math.min(100, Math.max(0, 100 - utilizationPercent));
}

function validDate(value: Date): Date | null {
  return Number.isNaN(value.getTime()) ? null : value;
}

function eventWindow(w: z.infer<typeof EventWindowSchema> | null | undefined): UsageWindow | null {
  if (w?.utilization == null) return null;
  return {
    leftPercent: leftFrom(w.utilization * 100),
    resetsAt: w.resetsAt == null ? null : validDate(new Date(w.resetsAt * 1000)),
  };
}

function probeWindow(w: z.infer<typeof ProbeWindowSchema> | null | undefined): UsageWindow | null {
  if (w?.utilization == null) return null;
  return {
    leftPercent: leftFrom(w.utilization),
    resetsAt: w.resets_at == null ? null : validDate(new Date(w.resets_at)),
  };
}

/** `info` is `SDKRateLimitInfo` from a `rate_limit_event` (utilization 0–1, epoch seconds). */
export function fromRateLimitEvent(info: unknown, at: Date): UsageSnapshot | null {
  const parsed = EventInfoSchema.safeParse(info);
  if (!parsed.success) return null;
  const windows = parsed.data.unifiedWindows;
  return {
    session: eventWindow(windows?.five_hour),
    weekly: eventWindow(windows?.seven_day),
    source: 'event',
    at,
    rejected: parsed.data.status === 'rejected',
  };
}

/** `response` is the usage probe response (utilization 0–100, ISO `resets_at`). */
export function fromUsageProbe(response: unknown, at: Date): UsageSnapshot | null {
  const parsed = ProbeSchema.safeParse(response);
  if (!parsed.success || !parsed.data.rate_limits) return null;
  const limits = parsed.data.rate_limits;
  return {
    session: probeWindow(limits.five_hour),
    weekly: probeWindow(limits.seven_day),
    source: 'probe',
    at,
    rejected: false,
  };
}
