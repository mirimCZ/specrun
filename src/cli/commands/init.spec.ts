import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureDeps, makeTempRepo } from '../../../test/fixtures/specRepo.js';
import { createProgram } from '../program.js';

let dir: string;
beforeEach(() => {
  dir = makeTempRepo();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function init(...args: string[]): Promise<void> {
  await createProgram(captureDeps(dir)).parseAsync(['node', 'specrun', 'init', ...args]);
}
const read = (file: string): string => readFileSync(join(dir, file), 'utf8');

describe('specrun init', () => {
  it('guesses verify steps from package.json scripts', async () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest', typecheck: 'tsc', build: 'x' } }),
    );
    await init();
    expect(JSON.parse(read('specrun.config.json'))).toEqual({
      verify: [
        { name: 'typecheck', command: 'npm run typecheck' },
        { name: 'test', command: 'npm run test' },
      ],
    });
  });

  it('writes a failing placeholder step without scripts', async () => {
    await init();
    const config = JSON.parse(read('specrun.config.json')) as {
      verify: { command: string }[];
    };
    expect(config.verify).toHaveLength(1);
    expect(config.verify[0]?.command).toContain('configure verify steps');
    expect(config.verify[0]?.command).toContain('exit 1');
  });

  it('adds the ignore and attributes lines once', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    await init();
    await init('--force');
    expect(read('.gitignore')).toBe('node_modules/\n.specrun/\n');
    expect(read('.gitattributes')).toBe('**/events.jsonl merge=union\n');
  });

  it('refuses to overwrite a config without --force', async () => {
    await init();
    writeFileSync(join(dir, 'specrun.config.json'), '{"custom":true}');
    await expect(init()).rejects.toThrow(/already exists/);
    expect(read('specrun.config.json')).toBe('{"custom":true}');
    await init('--force');
    expect(read('specrun.config.json')).toContain('verify');
  });
});
