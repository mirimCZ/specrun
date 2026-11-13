import { createPrompter, type Prompter } from '../../src/cli/prompter.js';

export interface ScriptedPrompter {
  prompter: Prompter;
  /** Every prompt shown, in order. */
  prompts: string[];
}

/** Answers prompts with `answers` in order ('' = Enter); an extra prompt fails the test. */
export function createScriptedPrompter(answers: readonly string[]): ScriptedPrompter {
  const queue = [...answers];
  const prompts: string[] = [];
  const prompter = createPrompter((prompt) => {
    prompts.push(prompt);
    const answer = queue.shift();
    if (answer === undefined) return Promise.reject(new Error(`unexpected prompt: ${prompt}`));
    return Promise.resolve(answer);
  });
  return { prompter, prompts };
}
