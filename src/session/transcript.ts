import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { finished } from 'node:stream/promises';
import { constants, createGzip, gunzipSync } from 'node:zlib';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export type TranscriptWriter = {
  write(message: SDKMessage): void;
  /** Ends the gzip stream; rejects if any write to the file failed. */
  close(): Promise<void>;
};

/** `file` = `<transcriptsDir>/<repo>/<spec>/<task>/<sessionId>-<segment>.jsonl.gz` (SRD-14). */
export function createTranscriptWriter(file: string): TranscriptWriter {
  mkdirSync(dirname(file), { recursive: true });
  const gzip = createGzip();
  const out = createWriteStream(file);
  gzip.pipe(out);
  let failure: unknown = null;
  // Without listeners a disk error would crash the process; it is reported by `close` instead.
  gzip.on('error', (error) => (failure ??= error));
  out.on('error', (error) => (failure ??= error));
  return {
    write(message) {
      if (failure !== null) return;
      gzip.write(`${JSON.stringify(message)}\n`);
      // A sync flush per message ends on a byte boundary, so a crash leaves a readable prefix.
      gzip.flush(constants.Z_SYNC_FLUSH);
    },
    async close() {
      if (failure === null) {
        gzip.end();
        await finished(out).catch((error: unknown) => (failure ??= error));
      } else {
        out.destroy();
      }
      if (failure !== null) throw failure;
    },
  };
}

function isMessage(value: unknown): value is SDKMessage {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  );
}

/** All complete messages of a transcript; a truncated stream (crash) yields its complete lines. */
export function readTranscript(file: string): SDKMessage[] {
  // Z_SYNC_FLUSH as finishFlush makes gunzip return what it decoded instead of failing on a
  // missing trailer.
  const text = gunzipSync(readFileSync(file), { finishFlush: constants.Z_SYNC_FLUSH }).toString(
    'utf8',
  );
  const lines = text.split('\n');
  // The last element is empty for a complete file and a partial line for a truncated one.
  lines.pop();
  const messages: SDKMessage[] = [];
  for (const line of lines) {
    const value: unknown = JSON.parse(line);
    if (isMessage(value)) messages.push(value);
  }
  return messages;
}
