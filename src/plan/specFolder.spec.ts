import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempRepo } from '../../test/fixtures/specRepo.js';
import { ConfigSchema } from '../config/configSchema.js';
import { nextSpecNumber, resolvePlanFolder } from './specFolder.js';

const config = ConfigSchema.parse({ verify: [{ name: 'ok', command: 'true' }], specsDir: 'spec' });

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const mk = (...parts: string[]): void => {
  mkdirSync(join(dir, ...parts), { recursive: true });
};

describe('nextSpecNumber', () => {
  it('uses the highest number plus one, ignoring gaps and unnumbered names', () => {
    expect(nextSpecNumber([])).toBe('001');
    expect(nextSpecNumber(['archive', 'notes'])).toBe('001');
    expect(nextSpecNumber(['001-a', '004-b', 'archive'])).toBe('005');
  });
});

describe('resolvePlanFolder', () => {
  it('numbers over active and archived folders, creating nothing', () => {
    mk('spec', '002-a');
    mk('spec', 'archive', '007-old');
    const folder = resolvePlanFolder(dir, config, 'new-one');
    expect(folder).toEqual({
      spec: '008-new-one',
      dir: join(dir, 'spec', '008-new-one'),
      created: true,
    });
    expect(() => mk('spec', '008-new-one')).not.toThrow();
  });

  it('starts at 001', () => {
    expect(resolvePlanFolder(dir, config, 'first').spec).toBe('001-first');
  });

  it('continues an existing folder', () => {
    mk('spec', '003-feature');
    expect(resolvePlanFolder(dir, config, 'feature')).toMatchObject({
      spec: '003-feature',
      created: false,
    });
  });

  it('refuses archived and numeric-prefixed names', () => {
    mk('spec', 'archive', '002-gone');
    expect(() => resolvePlanFolder(dir, config, 'gone')).toThrow('choose another name');
    expect(() => resolvePlanFolder(dir, config, '005-foo')).toThrow('without the number');
    expect(() => resolvePlanFolder(dir, config, 'Bad_Name')).toThrow('Invalid spec name');
  });

  it('refuses a spec with a worktree', () => {
    mk('spec', '001-wt');
    mk('.specrun', 'worktrees', '001-wt');
    expect(() => resolvePlanFolder(dir, config, 'wt')).toThrow('edit the spec in its worktree');
  });
});
