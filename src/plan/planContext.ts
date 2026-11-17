export interface PlanContextInput {
  spec: string;
  /** Repo-relative folder. */
  dir: string;
  /** Files already in the folder; empty for a new spec. */
  files: readonly string[];
  specsDir: string;
  /** Content of `--file`, verbatim; null when none was given. */
  request: string | null;
}

/** Only facts the model cannot get cheaply (PLD-4). */
export function renderPlanContext(input: PlanContextInput): string {
  const { spec, dir, files, specsDir, request } = input;
  const state =
    files.length === 0 ? 'new' : `existing, contains:\n${files.map((f) => `- ${f}`).join('\n')}`;
  return [
    '# Plan context',
    '',
    `- Spec: ${spec}`,
    `- Folder: ${dir}`,
    `- State: ${state}`,
    `- specsDir: ${specsDir}`,
    '',
    request === null
      ? 'No request file — ask the user for the request.'
      : `<request>\n${request}\n</request>`,
    '',
    "Write the spec into exactly this folder; don't compute a new number.",
    '',
  ].join('\n');
}

export type PlanLaunch =
  | { kind: 'new'; spec: string; sessionId: string; contextFile: string }
  | { kind: 'resume'; spec: string; sessionId: string; contextFile: string };

/** Arguments of `claude` (PLD-3) and the first message. */
export function planLaunchArgs(launch: PlanLaunch): { args: string[]; message: string } {
  if (launch.kind === 'new') {
    const message = `/specrun:plan ${launch.spec}`;
    return {
      args: [
        '--session-id',
        launch.sessionId,
        '-n',
        `plan ${launch.spec}`,
        '--append-system-prompt-file',
        launch.contextFile,
        message,
      ],
      message,
    };
  }
  const message = `Continue planning ${launch.spec}.`;
  return {
    args: [
      '--resume',
      launch.sessionId,
      '--append-system-prompt-file',
      launch.contextFile,
      message,
    ],
    message,
  };
}
