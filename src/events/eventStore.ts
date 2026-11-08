import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  truncateSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { formatIssues } from '../config/loadConfig.js';
import { SpecrunError } from '../errors.js';
import {
  EVENT_TYPES,
  EVENT_VERSION,
  EventSchema,
  type NewEvent,
  type SpecrunEvent,
} from './eventSchema.js';

export const EVENTS_FILE = 'events.jsonl';

export interface ReadResult {
  events: SpecrunEvent[];
  /** Lines with an event type this version doesn't know (written by a newer specrun). */
  unknown: number;
}

export interface ReadOptions {
  onWarning?: (message: string) => void;
}

export interface EventStoreDeps {
  file: string;
  runId: string;
  clock: { now(): Date };
  onWarning?: (message: string) => void;
  /** Seam for tests; defaults to `fsyncSync`. */
  fsync?: (fd: number) => void;
}

export interface EventStore {
  append(event: NewEvent): SpecrunEvent;
  read(): ReadResult;
}

export function createEventStore(deps: EventStoreDeps): EventStore {
  const fsync = deps.fsync ?? fsyncSync;
  const readOptions: ReadOptions =
    deps.onWarning === undefined ? {} : { onWarning: deps.onWarning };

  return {
    append(event) {
      const parsed = EventSchema.safeParse({
        ...event,
        v: EVENT_VERSION,
        at: deps.clock.now().toISOString(),
        runId: deps.runId,
      });
      if (!parsed.success) {
        throw new SpecrunError(
          'events-invalid',
          `Refusing to append an invalid ${event.t} event`,
          formatIssues(parsed.error),
        );
      }
      mkdirSync(dirname(deps.file), { recursive: true });
      const prefix = repairTornTail(deps.file, readOptions.onWarning);
      const fd = openSync(deps.file, 'a');
      try {
        appendFileSync(fd, `${prefix}${JSON.stringify(parsed.data)}\n`);
        fsync(fd);
      } finally {
        closeSync(fd);
      }
      return parsed.data;
    },
    read() {
      return readEvents(deps.file, readOptions);
    },
  };
}

/**
 * A crash mid-append leaves bytes after the last newline. Appending behind them would glue two
 * events into one corrupt middle line, so before writing: a complete-but-unterminated line gets
 * its newline (returned as prefix), a torn one — never a recorded event — is cut off.
 */
function repairTornTail(file: string, onWarning: ((message: string) => void) | undefined): string {
  if (!existsSync(file)) return '';
  const size = statSync(file).size;
  if (size === 0 || lastByte(file, size) === 0x0a) return '';
  const content = readFileSync(file);
  const tailStart = content.lastIndexOf(0x0a) + 1;
  const tail = content.subarray(tailStart).toString('utf8');
  if (parsesAsJson(tail)) return '\n';
  truncateSync(file, tailStart);
  onWarning?.(`${file}: removed a half-written last line (${size - tailStart} bytes)`);
  return '';
}

function lastByte(file: string, size: number): number | undefined {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1);
    readSync(fd, buffer, 0, 1, size - 1);
    return buffer[0];
  } finally {
    closeSync(fd);
  }
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Missing file = no events. Only the last line may be unparsable (a crash mid-append). */
export function readEvents(file: string, options: ReadOptions = {}): ReadResult {
  if (!existsSync(file)) return { events: [], unknown: 0 };
  const lines = readFileSync(file, 'utf8').split('\n');
  const lastIndex = lines.findLastIndex((line) => line.trim() !== '');
  const events: SpecrunEvent[] = [];
  let unknown = 0;

  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const lineNo = index + 1;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (index === lastIndex) {
        options.onWarning?.(`${file}:${lineNo}: skipped a half-written last line (${reason})`);
        continue;
      }
      throw new SpecrunError('events-invalid', `${file} is corrupt`, [`line ${lineNo}: ${reason}`]);
    }
    const type = typeof value === 'object' && value !== null && 't' in value ? value.t : undefined;
    if (typeof type === 'string' && !EVENT_TYPES.has(type)) {
      unknown += 1;
      continue;
    }
    const parsed = EventSchema.safeParse(value);
    if (!parsed.success) {
      throw new SpecrunError(
        'events-invalid',
        `${file} has an invalid event`,
        formatIssues(parsed.error).map((issue) => `line ${lineNo}: ${issue}`),
      );
    }
    events.push(parsed.data);
  }
  return { events, unknown };
}
