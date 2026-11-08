# SR-5 — Runner protocol, prompt, specrun tools

Phase 1 · Needs: SR-2 · Implements: SRD-9, SRD-18, SRD-6 (protocol text)

What the agent sees: the built-in protocol (how a specrun task works), the session prompt
assembled from protocol + spec prompt + brief + dependency notes, and the two MCP tools the
agent ends every session with.

## Decisions

- **SRD-9** — MCP server `specrun` with two tools. `complete_task` — `summary` (one sentence),
  `commitMessage` (Conventional Commit subject), `notes` (string[], ≤ 15, for dependent tasks),
  `deviations` ({ `kind`: `spec-bug` · `ambiguity` · `constraint` · `test-trap` · `scope`,
  `decision?`, `what`, `why` }[]). `block_task` — `reason`, `kind`: `impossible` · `test` ·
  `forbidden` · `other`. Both answer "Recorded — end your turn now."
- **SRD-18** — prompt = built-in protocol (`src/session/protocol.md`, shipped with the package)
  - optional `docs/<spec>/TASK_PROMPT.md` (`{TASK}` replaced) + the brief `tasks/<ID>.md` + for
    every dependency a section with its `notes` and `deviations` from its last `task.completed`.
    The character count of each part is recorded on `session.started`.
- **SRD-6** — the agent only edits files; the runner verifies (red → the same session gets the
  failure summary, ≤ `verifyFixRounds` rounds) and commits.
- **SRD-23** — tools `Read`, `Edit`, `Write`, `Bash` + the two specrun tools.

## Read first

- `CLAUDE.md`, `docs/testing.md`.
- `docs/spikes/agent-sdk.md` + `spikes/sdk-spike.ts` (`completeTask` / `createSdkMcpServer`) —
  the working tool definition pattern.
- `docs/v1/TASK_PROMPT.md` — the old-style prompt: its "Rules" (ambiguity, blocked, spec bugs,
  foreground commands) are what the protocol must say in the new world.
- SR-2 notes below — `CompleteTaskPayloadSchema`, `DeviationSchema`, `TaskState.lastCompleted`.
- SR-1 notes below — `LoadedSpec` (`briefPath`, `taskPromptPath`).

## Changes

- New `src/session/protocol.md` (≤ 60 lines, English, second person) — the agent's contract:
  you implement exactly one task unattended; read the brief's Read-first files, don't explore
  beyond them; **never run git commands that change state** (add, commit, checkout, stash,
  reset) — the runner commits; run commands in the foreground only; when done call
  `complete_task` (notes = what dependents need: files, exported names, deviations; record
  **every** deviation from the brief with the right kind; a test problem that cost several
  attempts is a `test-trap`); when impossible call `block_task` and revert nothing (the runner
  parks the work); after `complete_task` the runner verifies — if it fails you get the summary
  in the same session, fix it and call `complete_task` again; ambiguity → simplest option
  consistent with the brief + a deviation of kind `ambiguity`. Copied to `dist/session/` by the
  build (adjust `package.json` `build` script: `tsc … && node scripts/copy-assets.mjs` or
  equivalent; keep it dependency-free).
- New `src/session/specrunTools.ts`: `createSpecrunTools(onCall: (call: ToolCall) => void)` →
  `{ server, allowedTools }` where `ToolCall = { tool: 'complete_task', payload } |
{ tool: 'block_task', reason, kind }`; zod shapes reuse SR-2's schemas (convert or share the
  shape — one definition). Constants `COMPLETE_TASK_TOOL = 'mcp__specrun__complete_task'`,
  `BLOCK_TASK_TOOL`.
- New `src/session/buildPrompt.ts`: `buildPrompt({ spec: LoadedSpec, task, state, protocol })`
  → `{ text, parts: { protocol, spec, brief, deps } }` (chars). Dependency section per need in
  `needs` order: `## Implementation notes of <ID> (dependency)` + notes as bullets +
  `Deviations:` bullets `[kind] decision: what — why`; a dependency without `lastCompleted`
  (e.g. set done manually) gets "No notes recorded." `loadProtocol()` reads the shipped file.
- New `src/session/followUps.ts`: the fixed texts the runner sends when resuming:
  `verifyFailedPrompt(summary, round, maxRounds)`, `limitResumePrompt()`,
  `crashResumePrompt()`, `noCallNudgePrompt()` ("You ended without calling complete_task or
  block_task …").

## Done when

- `specrunTools.spec.ts`: the handlers record typed calls, reject invalid payloads (zod), the
  tool names match the constants (inspect the server's tool list if the SDK exposes it,
  otherwise the definitions passed to `createSdkMcpServer`).
- `buildPrompt.spec.ts`: parts order and sizes, `{TASK}` replaced, missing `TASK_PROMPT.md`
  → `spec` part 0, dependency notes + deviations rendered, missing notes text.
- `followUps.spec.ts`: round numbers and summary included.
- `npm run build` copies `protocol.md` to `dist/session/`.
- `tools/spec-verify.sh` green.

## Implementation notes

<!-- Filled in by the implementing agent: files, exported names, deviations. -->
