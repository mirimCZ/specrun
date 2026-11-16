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
});
