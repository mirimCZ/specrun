import { render, useInput, useStdin } from 'ink';
import { createElement, useEffect, useState, type ReactElement } from 'react';
import type { RunControls } from '../cli/runControls.js';
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
  controls: RunControls;
  now?: () => Date;
}

interface LiveProps {
  store: DashboardStore;
  controls: RunControls;
  now: () => Date;
  stdout: NodeJS.WriteStream;
  /** Changing it forces a render outside the tick (the final frame). */
  revision: number;
}

function LiveDashboard({ store, controls, now, stdout }: LiveProps): ReactElement {
  const [frame, setFrame] = useState(0);
  const { isRawModeSupported } = useStdin();
  useEffect(() => {
    const timer = setInterval(() => setFrame((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  // Raw mode turns Ctrl+C into a key instead of SIGINT, so it is handled here too.
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') controls.interrupt();
      else if (input === 's') controls.requestStop();
      else if (input === 'c') controls.cancelStop();
    },
    { isActive: isRawModeSupported },
  );
  return createElement(Dashboard, {
    view: store.snapshot(),
    control: { keys: isRawModeSupported, stopRequested: controls.stop.requested },
    now: now(),
    frame,
    // Read each frame, so a resized terminal is picked up; 0 or unknown when the TTY reports no size.
    width: stdout.columns || 80,
  });
}

/** SRD-2: the dashboard on a TTY. Ink never exits on its own: Ctrl+C goes to `controls`. */
export function createInkReporter(options: InkReporterOptions): InkReporter {
  const now = options.now ?? ((): Date => new Date());
  const store = createDashboardStore({ now });
  const element = (revision: number): ReactElement =>
    createElement(LiveDashboard, {
      store,
      controls: options.controls,
      now,
      stdout: options.stdout,
      revision,
    });
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
