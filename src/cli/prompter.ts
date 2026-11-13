import { createInterface } from 'node:readline/promises';
import { SpecrunError } from '../errors.js';

/** Questions with a default in brackets; Enter takes it. */
export interface Prompter {
  text(question: string, fallback: string): Promise<string>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
  close(): void;
}

/** Answers one raw line; rejects when the user cancels. */
export type ReadLine = (prompt: string) => Promise<string>;

/** The parsing of answers, independent of where the lines come from (tests script them). */
export function createPrompter(readLine: ReadLine, close: () => void = () => undefined): Prompter {
  return {
    async text(question, fallback) {
      const hint = fallback === '' ? '' : ` [${fallback}]`;
      const answer = (await readLine(`${question}${hint}: `)).trim();
      return answer === '' ? fallback : answer;
    },
    async confirm(question, fallback) {
      for (;;) {
        const answer = (await readLine(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim();
        if (answer === '') return fallback;
        if (/^y(es)?$/i.test(answer)) return true;
        if (/^no?$/i.test(answer)) return false;
      }
    },
    close,
  };
}

export function createTerminalPrompter(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Prompter {
  const rl = createInterface({ input, output });
  const cancel = new AbortController();
  // Without a listener readline swallows Ctrl+C and the question never returns.
  rl.on('SIGINT', () => cancel.abort());
  return createPrompter(
    async (prompt) => {
      try {
        return await rl.question(prompt, { signal: cancel.signal });
      } catch (error) {
        if (cancel.signal.aborted) {
          output.write('\n');
          throw new SpecrunError('cancelled', 'Cancelled — nothing was written');
        }
        throw error;
      }
    },
    () => rl.close(),
  );
}
