import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpecrunError } from '../errors.js';
import { GLOBAL_CONFIG_FILE, loadGlobalConfig } from './globalConfig.js';

let home: string;
const deps = { homedir: (): string => home };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'specrun-home-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function writeRaw(content: string): void {
  mkdirSync(join(home, '.specrun'), { recursive: true });
  writeFileSync(join(home, GLOBAL_CONFIG_FILE), content);
}

function writeGlobal(value: unknown): void {
  writeRaw(JSON.stringify(value));
}

function loadError(): SpecrunError {
  try {
    loadGlobalConfig(deps);
  } catch (error) {
    if (error instanceof SpecrunError) return error;
    throw error;
  }
  throw new Error('loadGlobalConfig did not throw');
}

describe('loadGlobalConfig', () => {
  it('treats a missing file as a config without accounts', () => {
    expect(loadGlobalConfig(deps)).toEqual({ accounts: [] });
  });

  it('defaults accounts to an empty list', () => {
    writeGlobal({});
    expect(loadGlobalConfig(deps)).toEqual({ accounts: [] });
  });

  it('parses both token kinds, limits and a tokenless account', () => {
    const accounts = [
      { name: 'lorem', token: { env: 'LOREM_TOKEN' }, limits: { sessionMinLeft: 10 } },
      { name: 'ipsum-2', token: { command: 'pass show ipsum' } },
      { name: 'dolor', limits: { sessionMinLeft: 30, weeklyMinLeft: 20 } },
    ];
    writeGlobal({ accounts });
    expect(loadGlobalConfig(deps)).toEqual({ accounts });
  });

  it('fails with config-invalid on broken JSON', () => {
    writeRaw('{ accounts: ');
    const error = loadError();
    expect(error.code).toBe('config-invalid');
    expect(error.summary).toBe('~/.specrun/config.json is invalid');
    expect(error.details).toHaveLength(1);
  });

  it.each([
    [
      'a duplicate name',
      { accounts: [{ name: 'lorem', token: { env: 'A' } }, { name: 'lorem' }] },
      /^accounts\.1\.name: .*duplicate/,
    ],
    [
      'two tokenless accounts',
      { accounts: [{ name: 'lorem' }, { name: 'ipsum' }] },
      /^accounts\.1: /,
    ],
    ['a bad name', { accounts: [{ name: 'Lorem_Ipsum' }] }, /^accounts\.0\.name: /],
    ['an unknown key', { accounts: [], extra: 1 }, /^\(root\): .*extra/],
    [
      'an unknown key in a token',
      { accounts: [{ name: 'lorem', token: { env: 'A', command: 'b' } }] },
      /^accounts\.0\.token: /,
    ],
  ])('fails with config-invalid on %s', (_label, value, detail) => {
    writeGlobal(value);
    const error = loadError();
    expect(error.code).toBe('config-invalid');
    expect(error.details).toHaveLength(1);
    expect(error.details[0]).toMatch(detail);
  });

  it('lists one detail per issue', () => {
    writeGlobal({
      accounts: [
        { name: 'lorem' },
        { name: 'lorem', token: { env: 'A' } },
        { name: '-bad', token: { env: 'B' }, limits: { x: 1 } },
      ],
    });
    const error = loadError();
    expect(error.details).toHaveLength(3);
  });
});
