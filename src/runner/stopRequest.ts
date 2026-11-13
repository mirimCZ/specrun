/**
 * "Finish the current task, then stop": unlike the abort signal it can be withdrawn, so it is a
 * flag with listeners rather than an `AbortSignal`.
 */
export interface StopRequest {
  readonly requested: boolean;
  /** Called on every request; returns the unsubscribe function. */
  onRequest(listener: () => void): () => void;
}

export interface StopControl extends StopRequest {
  request(): void;
  cancel(): void;
}

export function createStopRequest(): StopControl {
  let requested = false;
  const listeners = new Set<() => void>();
  return {
    get requested() {
      return requested;
    },
    onRequest(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    request() {
      if (requested) return;
      requested = true;
      for (const listener of [...listeners]) listener();
    },
    cancel() {
      requested = false;
    },
  };
}

/** A request nobody can make: the default for callers without controls. */
export const NO_STOP: StopRequest = {
  requested: false,
  onRequest: () => () => undefined,
};
