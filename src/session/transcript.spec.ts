import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assistantMessage,
  initMessage,
  resultSuccess,
  toolResultMessage,
} from '../../test/fixtures/sdkMessages.js';
import { createTranscriptWriter, readTranscript } from './transcript.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specrun-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const messages = [
  initMessage(),
  assistantMessage({ text: 'x'.repeat(2000), usage: { input: 10, output: 5 } }),
  toolResultMessage({ text: 'y'.repeat(2000) }),
  resultSuccess({ turns: 2, costUsd: 0.01 }),
];

describe('transcript', () => {
  it('round-trips messages and creates missing directories', async () => {
    const file = join(dir, 'repo', 'v1', 'SR-6', 'session-1-1.jsonl.gz');
    const writer = createTranscriptWriter(file);
    for (const message of messages) writer.write(message);
    await writer.close();

    expect(readFileSync(file).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(readTranscript(file)).toEqual(messages);
  });

  it('reads the complete lines of a truncated stream', async () => {
    const file = join(dir, 't.jsonl.gz');
    const writer = createTranscriptWriter(file);
    for (const message of messages) writer.write(message);
    await writer.close();

    // Cut inside the last message: no trailer, a partial last line.
    const bytes = readFileSync(file);
    const truncated = join(dir, 'truncated.jsonl.gz');
    writeFileSync(truncated, bytes.subarray(0, bytes.length - 40));

    const read = readTranscript(truncated);
    expect(read).toEqual(messages.slice(0, 3));
  });

  it('reads an empty transcript', async () => {
    const file = join(dir, 'empty.jsonl.gz');
    await createTranscriptWriter(file).close();
    expect(readTranscript(file)).toEqual([]);
  });
});
