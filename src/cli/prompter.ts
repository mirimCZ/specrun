import { createInterface } from 'node:readline/promises';
import { SpecrunError } from '../errors.js';

/** Questions with a default in brackets; Enter takes it. */
export interface Prompter {
  text(question: string, fallback: string): Promise<string>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
  close(): void;
}

/** Enter takes yes; Ctrl+C at the question counts as no instead of an error. */
export async function askYes(prompter: () => Prompter, question: string): Promise<boolean> {
  // One prompter per question: Claude Code reads the same stdin in between.
  const open = prompter();
  try {
    return await open.confirm(question, true);
  } catch (error) {
    if (error instanceof SpecrunError && error.code === 'cancelled') return false;
    throw error;
  } finally {
    open.close();
  }
}

/** Answers one raw line; rejects when the user cancels. The placeholder shows what Enter takes. */
export type ReadLine = (prompt: string, placeholder?: string) => Promise<string>;

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
        const prompt = `${question} ${fallback ? '[Y/n]' : '[y/N]'} `;
        const answer = (await readLine(prompt, fallback ? 'Y' : 'N')).trim();
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
  // Ink unrefs stdin when the dashboard unmounts; unref'd, a pending question does not keep the
  // event loop alive and node exits with "unsettled top-level await".
  (input as Partial<{ ref: () => void }>).ref?.();
  const rl = createInterface({ input, output });
  const cancel = new AbortController();
  // Without a listener readline swallows Ctrl+C and the question never returns.
  rl.on('SIGINT', () => cancel.abort());
  return createPrompter(
    async (prompt, placeholder) => {
      const answer = rl.question(prompt, { signal: cancel.signal });
      if (placeholder !== undefined && rl.terminal) showPlaceholder(input, output, placeholder);
      try {
        return await answer;
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

/**
 * Dimmed text after the cursor, as CLIs show a default. Readline doesn't redraw the line when
 * typing at its end, so the first key also clears the rest of it; on Enter it stays as the answer.
 */
function showPlaceholder(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  placeholder: string,
): void {
  output.write(`\x1b[2m${placeholder}\x1b[22m\x1b[${placeholder.length}D`);
  input.once('keypress', () => output.write('\x1b[K'));
}
