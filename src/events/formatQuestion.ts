import type { DeviationQuestion } from './eventSchema.js';

/** One line, shared by PROGRESS.md, dependency prompts and `specrun deviations`. */
export function formatQuestion({ text, options, chosen }: DeviationQuestion): string {
  const others = options.filter((option) => option !== chosen);
  return `Q: ${oneLine(text)} → ${oneLine(chosen)} (over ${others.map(oneLine).join(' · ')})`;
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}
