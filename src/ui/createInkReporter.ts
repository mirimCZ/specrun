import { render } from 'ink';
import { createElement, useEffect, useState, type ReactElement } from 'react';
import type { RunReporter } from '../runner/reporter.js';
import { Dashboard } from './Dashboard.js';
import { createDashboardStore, type DashboardStore } from './dashboardStore.js';

/** Redraws for the spinner and clocks; it also throttles bursts of tool calls to one frame. */
export const TICK_MS = 200;

export interface InkReporter {
  reporter: RunReporter;
  /** Draws the final frame and gives the terminal back; call before printing anything else. */
  unmount(): Promise<void>;
}

export interface InkReporterOptions {
  stdout: NodeJS.WriteStream;
  now?: () => Date;
}

interface LiveProps {
  store: DashboardStore;
  now: () => Date;
  stdout: NodeJS.WriteStream;
  /** Changing it forces a render outside the tick (the final frame). */
  revision: number;
}

function LiveDashboard({ store, now, stdout }: LiveProps): ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return createElement(Dashboard, {
    view: store.snapshot(),
    now: now(),
    frame,
    // Read each frame, so a resized terminal is picked up; unknown when not a real TTY.
    width: stdout.columns ?? 80,
  });
}

/** SRD-2: the dashboard on a TTY. Ctrl+C stays with specrun's own signal handler (graceful abort). */
export function createInkReporter(options: InkReporterOptions): InkReporter {
  const now = options.now ?? ((): Date => new Date());
  const store = createDashboardStore({ now });
  const element = (revision: number): ReactElement =>
    createElement(LiveDashboard, { store, now, stdout: options.stdout, revision });
  const instance = render(element(0), { stdout: options.stdout, exitOnCtrlC: false });
  let unmounted = false;
  return {
    reporter: store,
    async unmount() {
      if (unmounted) return;
      unmounted = true;
      instance.rerender(element(1));
      instance.unmount();
      await instance.waitUntilExit();
    },
  };
}
