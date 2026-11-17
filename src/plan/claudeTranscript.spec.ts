import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeConfigDir, findClaudeTranscript, readPlanMetrics } from './claudeTranscript.js';

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

function assistant(
  id: string,
  usage: Usage,
  options: { model?: string; sidechain?: boolean } = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    ...(options.sidechain === undefined ? {} : { isSidechain: options.sidechain }),
    message: {
      id,
      model: options.model ?? 'claude-opus',
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
      },
    },
  });
}

function usage(input: number, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  return { input, output, cacheRead, cacheWrite };
}

function writeLines(file: string, lines: string[]): string {
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

describe('readPlanMetrics', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts lines with the same message id as one turn, the last usage wins', () => {
    const file = writeLines(join(dir, 's1.jsonl'), [
      assistant('m1', usage(1, 1, 1, 1)),
      assistant('m1', usage(10, 20, 30, 40)),
    ]);
    expect(readPlanMetrics(file)).toMatchObject({
      turns: 1,
      inputTokens: 10,
      outputTokens: 20,
      cacheRead: 30,
      cacheWrite: 40,
    });
  });

  it('counts sidechain lines and subagent files into subagents only', () => {
    const file = writeLines(join(dir, 's1.jsonl'), [
      assistant('m1', usage(100, 10)),
      assistant('side', usage(5, 6, 7, 8), { sidechain: true, model: 'claude-haiku' }),
    ]);
    const subagents = join(dir, 's1', 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeLines(join(subagents, 'agent-a.jsonl'), [
      assistant('a1', usage(1, 2, 3, 4)),
      assistant('a2', usage(1, 2, 3, 4)),
    ]);
    writeLines(join(subagents, 'agent-b.jsonl'), [assistant('b1', usage(1, 1, 1, 1))]);
    writeFileSync(join(subagents, 'notes.txt'), 'ignored');

    expect(readPlanMetrics(file)).toEqual({
      turns: 1,
      inputTokens: 100,
      outputTokens: 10,
      cacheRead: 0,
      cacheWrite: 0,
      peakContext: 100,
      models: ['claude-opus'],
      subagents: {
        files: 2,
        turns: 4,
        inputTokens: 8,
        outputTokens: 11,
        cacheRead: 14,
        cacheWrite: 17,
      },
    });
  });

  it('takes peakContext as the max of input + cacheRead + cacheWrite over main turns', () => {
    const file = writeLines(join(dir, 's1.jsonl'), [
      assistant('m1', usage(10, 999, 1_000, 200)),
      assistant('m2', usage(5, 0, 3_000, 100)),
      assistant('m3', usage(1, 0, 2_000, 0)),
      assistant('side', usage(0, 0, 50_000, 0), { sidechain: true }),
    ]);
    expect(readPlanMetrics(file).peakContext).toBe(3_105);
  });

  it('lists distinct models of main turns in first-seen order', () => {
    const file = writeLines(join(dir, 's1.jsonl'), [
      assistant('m1', usage(1), { model: 'claude-sonnet' }),
      assistant('m2', usage(1), { model: 'claude-opus' }),
      assistant('m3', usage(1), { model: 'claude-sonnet' }),
      assistant('side', usage(1), { model: 'claude-haiku', sidechain: true }),
    ]);
    expect(readPlanMetrics(file).models).toEqual(['claude-sonnet', 'claude-opus']);
  });

  it('skips garbage and non-assistant lines', () => {
    const file = writeLines(join(dir, 's1.jsonl'), [
      'not json',
      '{"type":"assistant","message":{"id":"tr',
      JSON.stringify({ type: 'user', message: { id: 'u1', usage: { input_tokens: 99 } } }),
      JSON.stringify({ type: 'assistant', message: { id: 'no-usage' } }),
      JSON.stringify({ type: 'summary', summary: 'x' }),
      assistant('m1', usage(3, 4)),
    ]);
    expect(readPlanMetrics(file)).toMatchObject({ turns: 1, inputTokens: 3, outputTokens: 4 });
  });

  it('reports no subagent files when the folder is missing', () => {
    const file = writeLines(join(dir, 's1.jsonl'), [assistant('m1', usage(1))]);
    expect(readPlanMetrics(file).subagents).toEqual({
      files: 0,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
});

describe('findClaudeTranscript', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'specrun-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the transcript in any project folder', () => {
    mkdirSync(join(dir, 'projects', '-repo-a'), { recursive: true });
    mkdirSync(join(dir, 'projects', '-repo-b'), { recursive: true });
    const file = writeLines(join(dir, 'projects', '-repo-b', 'abc.jsonl'), []);
    expect(findClaudeTranscript('abc', dir)).toBe(file);
  });

  it('returns null when the transcript is missing', () => {
    mkdirSync(join(dir, 'projects', '-repo-a'), { recursive: true });
    expect(findClaudeTranscript('abc', dir)).toBeNull();
    expect(findClaudeTranscript('abc', join(dir, 'nope'))).toBeNull();
  });
});

describe('claudeConfigDir', () => {
  it('prefers CLAUDE_CONFIG_DIR', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/custom' }, '/home/u')).toBe('/custom');
  });

  it('falls back to ~/.claude', () => {
    expect(claudeConfigDir({}, '/home/u')).toBe(join('/home/u', '.claude'));
  });
});
