import { posix } from 'node:path';
import { looksLikePath } from './readFirst.js';

/** What one Bash command did to files, as far as its text shows (a heuristic). */
export interface BashFileAccess {
  /** Files whose content the command prints (`cat`, `sed -n`, `head`, …), resolved against `cd`. */
  reads: string[];
  /** Files the command changes by a path it names (`sed -i`, `>`, `tee`, Python `open(…, 'w')`). */
  edits: string[];
  /** Whether the command changes files at all, also when no path is recognizable. */
  changesFiles: boolean;
  /** The shell's directory afterwards: `cd` carries over to the next command. */
  dir: string | null;
}

const PRINTING = new Set(['cat', 'head', 'tail', 'nl', 'less', 'more']);
const PYTHON = new Set(['python', 'python3']);
const VALUE_OPTIONS: Record<string, readonly string[]> = {
  head: ['-n', '-c'],
  tail: ['-n', '-c'],
};
const PYTHON_WRITE = /open\([^)]*,\s*['"][wa]\+?['"]|\.write_text\(|\.write_bytes\(/;
const PYTHON_PATH_LITERALS = [
  /\bopen\(\s*(['"])([^'"\n]+)\1/g,
  /\bPath\(\s*(['"])([^'"\n]+)\1/g,
  /(?:^|[;\s])\w+\s*=\s*(['"])([^'"\n]+)\1/g,
];
const HEREDOC = /(?<!<)<<-?\s*(['"]?)([A-Za-z_]\w*)\1/g;

type Word = { text: string; op: boolean };

/** Splits heredoc bodies off the script; the bodies come back in the order of their `<<`. */
function splitHeredocs(command: string): { script: string; bodies: string[] } {
  const script: string[] = [];
  const bodies: string[] = [];
  const pending: string[] = [];
  let body: string[] | null = null;
  for (const line of command.split('\n')) {
    if (body !== null) {
      if (line.trim() === pending[0]) {
        bodies.push(body.join('\n'));
        pending.shift();
        body = pending.length > 0 ? [] : null;
      } else {
        body.push(line);
      }
      continue;
    }
    script.push(line);
    for (const match of line.matchAll(HEREDOC)) pending.push(match[2] ?? '');
    if (pending.length > 0) body = [];
  }
  if (body !== null) bodies.push(body.join('\n'));
  return { script: script.join('\n'), bodies };
}

/** Shell words per simple command: quotes removed, operators (`>`, `<<`, …) marked. */
function tokenize(script: string): Word[][] {
  const segments: Word[][] = [];
  let words: Word[] = [];
  let word = '';
  let inWord = false;
  const endWord = (): void => {
    if (inWord) words.push({ text: word, op: false });
    word = '';
    inWord = false;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };

  for (let i = 0; i < script.length; i += 1) {
    const c = script[i] ?? '';
    const next = script[i + 1] ?? '';
    if (c === "'") {
      const end = script.indexOf("'", i + 1);
      const stop = end === -1 ? script.length : end;
      word += script.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (c === '"') {
      let j = i + 1;
      while (j < script.length && script[j] !== '"') {
        if (script[j] === '\\' && j + 1 < script.length) j += 1;
        word += script[j] ?? '';
        j += 1;
      }
      inWord = true;
      i = j;
    } else if (c === '\\') {
      if (next !== '\n') word += next;
      inWord = inWord || next !== '\n';
      i += 1;
    } else if ((c === '$' && next === '(') || c === '`') {
      // Command substitution stays inside the word; its value is unknown anyway.
      const close = c === '`' ? '`' : ')';
      let depth = 0;
      let j = c === '`' ? i + 1 : i + 2;
      word += c === '`' ? c : '$(';
      while (j < script.length && (script[j] !== close || depth > 0)) {
        if (c !== '`' && script[j] === '(') depth += 1;
        if (c !== '`' && script[j] === ')') depth -= 1;
        word += script[j] ?? '';
        j += 1;
      }
      word += close;
      inWord = true;
      i = j;
    } else if (c === '>' || c === '<') {
      // A file descriptor right before it (`2>`, `&>`) belongs to the operator.
      let op = /^(?:\d+|&)$/.test(word) ? word : '';
      if (op === '') endWord();
      word = '';
      inWord = false;
      op += c;
      while (script[i + 1] === c) {
        op += c;
        i += 1;
      }
      if (script[i + 1] === '&') {
        op += '&';
        i += 1;
      }
      words.push({ text: op, op: true });
    } else if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')') {
      endSegment();
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endSegment();
  return segments;
}

/** `dir` null: after a `cd` whose target is unknown, a relative path is unknown too. */
function resolve(dir: string | null, path: string): string | null {
  if (posix.isAbsolute(path)) return posix.normalize(path);
  return dir === null ? null : posix.join(dir, path);
}

/** Where the shell starts and what its output showed; all optional. */
export interface BashContext {
  /** The shell's directory before the command: `''` = paths as written, null = unknown. */
  dir?: string | null;
  /** The worktree, where Claude Code puts the shell back (e.g. after a failing command). */
  root?: string | null;
  /** `cd` targets the command's output reports as missing: those `cd`s change nothing. */
  failedCds?: readonly string[];
}

function cdTarget(
  dir: string | null,
  target: string | undefined,
  root: string | null,
): string | null {
  if (target === undefined || target === '-' || /[$~]/.test(target)) return null;
  // The transcript has no exit codes, so whether the last `cd` carried over is unknown; an agent
  // repeating it without an error was back in the worktree root.
  const repeated =
    dir !== null &&
    root !== null &&
    !posix.isAbsolute(target) &&
    dir.endsWith(`/${posix.normalize(target)}`);
  return resolve(repeated ? root : dir, target);
}

function isFileArg(text: string): boolean {
  return (
    !text.startsWith('-') &&
    !text.includes('$') &&
    !/[?*{}]/.test(text) &&
    text !== '/dev/null' &&
    looksLikePath(text)
  );
}

/** A redirect always writes a file, whatever its name looks like. */
function isRedirectTarget(text: string): boolean {
  return text !== '' && !text.includes('$') && text !== '/dev/null';
}

function sedFiles(args: readonly string[]): { files: string[]; inPlace: boolean } {
  let inPlace = false;
  let hasScript = false;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '-i' && args[i + 1] === '') {
      // BSD sed: `-i ''` is an empty backup suffix.
      inPlace = true;
      i += 1;
    } else if (/^-[a-zA-Z]*i/.test(arg) || arg.startsWith('--in-place')) {
      inPlace = true;
    } else if (arg === '-e' || arg === '-f') {
      hasScript = true;
      i += 1;
    } else if (!arg.startsWith('-')) {
      rest.push(arg);
    }
  }
  return { files: hasScript ? rest : rest.slice(1), inPlace };
}

function perlInPlaceFiles(args: readonly string[]): string[] {
  if (!args.some((arg) => /^-[a-zA-Z]*i/.test(arg))) return [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (arg === '-e' || arg === '-E' || /^-[a-zA-Z]*e$/.test(arg)) i += 1;
    else if (!arg.startsWith('-')) files.push(arg);
  }
  return files;
}

function printedFiles(command: string, args: readonly string[]): string[] {
  const withValue = VALUE_OPTIONS[command] ?? [];
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (withValue.includes(arg)) i += 1;
    else files.push(arg);
  }
  return files;
}

/** Python scripts edit through variables: every path literal of a writing script counts. */
function pythonEdits(source: string): { changes: boolean; paths: string[] } {
  if (!PYTHON_WRITE.test(source)) return { changes: false, paths: [] };
  const paths = PYTHON_PATH_LITERALS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((m) => m[2] ?? ''),
  );
  return { changes: true, paths };
}

/** Pure: the files one Bash command reads and edits, judged from its text alone. */
export function bashFileAccess(command: string, context: BashContext = {}): BashFileAccess {
  const root = context.root ?? null;
  const failedCds = context.failedCds ?? [];
  const { script, bodies } = splitHeredocs(command);
  const reads: string[] = [];
  const edits: string[] = [];
  let changesFiles = false;
  let dir = context.dir === undefined ? '' : context.dir;
  let heredocs = 0;
  const files = (args: readonly string[]): string[] =>
    args.filter(isFileArg).flatMap((arg) => resolve(dir, arg) ?? []);
  const edit = (args: readonly string[]): void => {
    const named = args.filter(isFileArg);
    changesFiles ||= named.length > 0;
    edits.push(...files(named));
  };

  for (const words of tokenize(script)) {
    const args: string[] = [];
    const segmentBodies: string[] = [];
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      if (word === undefined) continue;
      if (!word.op) {
        args.push(word.text);
        continue;
      }
      const target = words[i + 1];
      i += 1;
      if (/^\d*<<$/.test(word.text)) {
        segmentBodies.push(bodies[heredocs] ?? '');
        heredocs += 1;
      } else if (/>$/.test(word.text) && target !== undefined && isRedirectTarget(target.text)) {
        changesFiles = true;
        const path = resolve(dir, target.text);
        if (path !== null) edits.push(path);
      }
    }
    // Leading variable assignments and `timeout <seconds>` only wrap the command.
    while (args.length > 0 && /^\w+=/.test(args[0] ?? '')) args.shift();
    if (args[0] === 'timeout') args.splice(0, 2);
    const [name, ...rest] = args;
    if (name === undefined) continue;

    if (name === 'cd') {
      if (!failedCds.includes(rest[0] ?? '')) dir = cdTarget(dir, rest[0], root);
    } else if (PRINTING.has(name)) {
      reads.push(...files(printedFiles(name, rest)));
    } else if (name === 'sed') {
      const sed = sedFiles(rest);
      if (sed.inPlace) edit(sed.files);
      else reads.push(...files(sed.files));
    } else if (name === 'perl') {
      edit(perlInPlaceFiles(rest));
    } else if (name === 'tee') {
      edit(rest);
    } else if (PYTHON.has(name)) {
      const inline = rest[0] === '-c' && rest[1] !== undefined ? [rest[1]] : [];
      for (const source of [...segmentBodies, ...inline]) {
        const python = pythonEdits(source);
        changesFiles ||= python.changes;
        edits.push(...files(python.paths));
      }
    }
  }
  return { reads: [...new Set(reads)], edits: [...new Set(edits)], changesFiles, dir };
}
