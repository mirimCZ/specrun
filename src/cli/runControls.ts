import { createStopRequest, type StopRequest } from '../runner/stopRequest.js';

/** What the user can do to a running `specrun run`: Ctrl+C / SIGINT, and the dashboard's keys. */
export interface RunControls {
  readonly stop: StopRequest;
  /** Ctrl+C: the first asks to stop after the current task, the next one aborts right away. */
  interrupt(): void;
  requestStop(): void;
  cancelStop(): void;
}

export interface RunControlsDeps {
  abort: () => void;
  log: (message: string) => void;
}

export function createRunControls(deps: RunControlsDeps): RunControls {
  const stop = createStopRequest();
  const requestStop = (): void => {
    if (stop.requested) return;
    stop.request();
    deps.log(
      '⏹ stop requested — the current task finishes, no new one starts (Ctrl+C again: interrupt now)',
    );
  };
  return {
    stop,
    interrupt() {
      if (!stop.requested) return requestStop();
      deps.log('interrupting now — the task resumes on the next run');
      deps.abort();
    },
    requestStop,
    cancelStop() {
      if (!stop.requested) return;
      stop.cancel();
      deps.log('stop cancelled — the run goes on');
    },
  };
}
