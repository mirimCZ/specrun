import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createTerminalPrompter } from './prompter.js';

describe('createTerminalPrompter', () => {
  it('refs the input again, so a question after the Ink dashboard keeps node alive', async () => {
    const input = new PassThrough();
    let refs = 0;
    Object.assign(input, { ref: () => void refs++ });
    const prompter = createTerminalPrompter(input, new PassThrough());

    expect(refs).toBe(1);
    const answer = prompter.confirm('Go?', false);
    input.write('y\n');
    await expect(answer).resolves.toBe(true);
    prompter.close();
  });

  it('shows what Enter takes dimmed in a terminal and clears it on the first key', async () => {
    const input = new PassThrough();
    const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
    let written = '';
    output.on('data', (chunk: Buffer) => (written += chunk.toString()));
    const prompter = createTerminalPrompter(input, output);

    const answer = prompter.confirm('Go?', true);
    expect(written).toContain('Go? [Y/n] \x1b[11G\x1b[2mY\x1b[22m\x1b[1D');
    input.write('n');
    expect(written).toContain('n\x1b[K');
    input.write('\r');
    await expect(answer).resolves.toBe(false);
    prompter.close();
  });
});
