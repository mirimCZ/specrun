import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlanCommitMessage, readPlanCommitMessage } from './planCommit.js';

describe('parsePlanCommitMessage', () => {
  it('splits subject and body', () => {
    expect(parsePlanCommitMessage('\n docs(001-x): plan X \r\n\r\nWhy.\nMore.\n\n')).toEqual({
      subject: 'docs(001-x): plan X',
      body: 'Why.\nMore.',
    });
  });

  it('allows a subject only, and returns null without one', () => {
    expect(parsePlanCommitMessage('docs: x')).toEqual({ subject: 'docs: x', body: '' });
    expect(parsePlanCommitMessage(' \n\n')).toBeNull();
  });
});

describe('readPlanCommitMessage', () => {
  it('returns null for a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'specrun-'));
    try {
      expect(readPlanCommitMessage(join(dir, 'none.commit'))).toBeNull();
      writeFileSync(join(dir, 'x.commit'), 'docs: x\n');
      expect(readPlanCommitMessage(join(dir, 'x.commit'))).toEqual({
        subject: 'docs: x',
        body: '',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
