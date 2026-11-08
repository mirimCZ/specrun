export type KeepAwakeChild = {
  kill(): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  unref?(): unknown;
};

export type KeepAwakeSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'ignore' },
) => KeepAwakeChild;

export type KeepAwakeDeps = {
  pid: number;
  platform: NodeJS.Platform;
  spawn: KeepAwakeSpawn;
};

const NOOP = { stop(): void {} };

/**
 * Keeps a Mac awake while process `pid` runs (`caffeinate -i -w <pid>`). A no-op on other
 * platforms or when `caffeinate` cannot be spawned — it is a convenience, never a failure.
 */
export function keepAwake(deps: KeepAwakeDeps): { stop(): void } {
  if (deps.platform !== 'darwin') return NOOP;
  let child: KeepAwakeChild;
  try {
    child = deps.spawn('caffeinate', ['-i', '-w', String(deps.pid)], { stdio: 'ignore' });
  } catch {
    return NOOP;
  }
  // Spawn failures (ENOENT) arrive asynchronously as an 'error' event.
  child.on('error', () => {});
  child.unref?.();
  return {
    stop(): void {
      try {
        child.kill();
      } catch {
        // already gone
      }
    },
  };
}
