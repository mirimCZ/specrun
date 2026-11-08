import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createProgram } from './program.js';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

describe('createProgram', () => {
  it('prints the package version', async () => {
    const output: string[] = [];
    const program = createProgram()
      .exitOverride()
      .configureOutput({ writeOut: (text) => output.push(text) });

    await expect(program.parseAsync(['node', 'specrun', '--version'])).rejects.toThrow();
    expect(output.join('').trim()).toBe(version);
  });
});
