import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config/configSchema.js';
import type {
  CompleteTaskPayload,
  EventOf,
  NewEvent,
  SESSION_REASONS,
  SpecrunEvent,
} from '../events/eventSchema.js';
import { EVENTS_FILE, createEventStore } from '../events/eventStore.js';
import {
  deriveState,
  lowestOpenPhase,
  runnableTasks,
  type SpecState,
} from '../events/taskState.js';
import { buildCommitMessage } from '../git/commitMessage.js';
import { recordAnalytics } from '../analytics/recordAnalytics.js';
import { createGit } from '../git/git.js';
import { ensureWorktree } from '../git/worktree.js';
import { waitUntil, type Clock } from '../limits/clock.js';
import { decide, limitHitTarget, waitTarget } from '../limits/policy.js';
import type { UsageSnapshot } from '../limits/usage.js';
import type { ProcessRunner } from '../process/run.js';
import { PROGRESS_FILE, renderProgress } from '../progress/renderProgress.js';
import type { AgentSession, CumulativeTotals, SessionObserver } from '../session/agentSession.js';
import { buildPrompt, loadProtocol, type PromptParts } from '../session/buildPrompt.js';
import {
  crashResumePrompt,
  limitResumePrompt,
  noCallNudgePrompt,
  verifyFailedPrompt,
} from '../session/followUps.js';
import { loadSpec } from '../spec/loadSpec.js';
import type { SpecTask } from '../spec/specSchema.js';
import { runVerify } from '../verify/verify.js';
import { acquireLock, isProcessAlive, lockFile } from './lock.js';
import type { RunReporter, WaitingUpdate } from './reporter.js';

export interface RunSpecOptions {
  spec: string;
  /** Ref the spec branch is created from on the first run. */
  base: string;
  /** Run only this task (ignores phases). */
  taskFilter?: string;
  retryBlocked: boolean;
  allPhases: boolean;
  /** Model alias for every session instead of the task's `default` / `strong` mapping. */
  modelOverride?: string;
}

export interface RunSpecDeps {
  /** Main checkout; the spec runs in its worktree. */
  repoRoot: string;
  config: Config;
  session: AgentSession;
  run: ProcessRunner;
  clock: Clock;
  probeUsage: () => Promise<UsageSnapshot | null>;
  reporter: RunReporter;
  /** Ctrl-C: aborts the current session or wait. */
  signal: AbortSignal;
  version: string;
  /** Defaults: `process.pid` and a `kill(pid, 0)` probe. */
  pid?: number;
  isAlive?: (pid: number) => boolean;
}

export type RunReason = EventOf<'run.finished'>['reason'];

export interface RunResult {
  exitCode: 0 | 1 | 75 | 130;
  reason: RunReason;
  message?: string;
}

type SessionReason = (typeof SESSION_REASONS)[number];
type RunEnd = { reason: RunReason; message?: string };
type BlockSource = EventOf<'task.blocked'>['source'];

const EXIT_CODES: Readonly<Record<RunReason, RunResult['exitCode']>> = {
  done: 0,
  checkpoint: 0,
  'paused-weekly': 75,
  failed: 1,
  interrupted: 130,
};

/** A probe snapshot older than this is refreshed before the next pause check (SRD-10). */
export const SNAPSHOT_MAX_AGE_MS = 10 * 60_000;

// Follow-up prompts carry none of the initial parts.
const NO_PARTS: PromptParts = { protocol: 0, spec: 0, brief: 0, deps: 0 };

const ToolInputSchema = z
  .object({
    file_path: z.string(),
    path: z.string(),
    command: z.string(),
    pattern: z.string(),
    description: z.string(),
  })
  .partial();

function toolDetail(input: unknown): string {
  const parsed = ToolInputSchema.safeParse(input);
  if (!parsed.success) return '';
  const { file_path, path, command, pattern, description } = parsed.data;
  const detail = file_path ?? path ?? command ?? pattern ?? description ?? '';
  return detail.split('\n')[0] ?? '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function snapshotEvent(snapshot: UsageSnapshot): NewEvent {
  return {
    t: 'usage.snapshot',
    sessionLeft: snapshot.session?.leftPercent ?? null,
    sessionResetsAt: snapshot.session?.resetsAt?.toISOString() ?? null,
    weeklyLeft: snapshot.weekly?.leftPercent ?? null,
    weeklyResetsAt: snapshot.weekly?.resetsAt?.toISOString() ?? null,
    source: snapshot.source,
  };
}

/** Totals a crashed session reached, summed from its recorded segments (the SDK's are cumulative). */
function cumulativeOf(state: SpecState, task: string, sessionId: string): CumulativeTotals | null {
  const segments = state.sessions.filter((s) => s.task === task && s.sessionId === sessionId);
  if (segments.length === 0) return null;
  return segments.reduce<CumulativeTotals>(
    (sum, s) => ({
      turns: sum.turns + s.turns,
      inputTokens: sum.inputTokens + s.inputTokens,
      outputTokens: sum.outputTokens + s.outputTokens,
      cacheRead: sum.cacheRead + s.cacheRead,
      cacheWrite: sum.cacheWrite + s.cacheWrite,
      costUsd: sum.costUsd + s.costUsd,
    }),
    { turns: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
  );
}

/** The state as it will be once the commit is recorded, so the committed PROGRESS.md shows it done. */
function previewDone(state: SpecState, task: string, payload: CompleteTaskPayload): SpecState {
  const current = state.tasks.get(task);
  if (current === undefined) return state;
  const tasks = new Map(state.tasks);
  tasks.set(task, {
    ...current,
    status: 'done',
    resumeSessionId: null,
    lastCompleted: payload,
    blockedReason: null,
  });
  return { ...state, tasks };
}

/**
 * Runs the spec's tasks until it is done, a phase checkpoint is reached, the weekly limit stops
 * it or it is interrupted. Setup failures (lock, spec, worktree) throw — there is no event log to
 * record them in yet; everything after `run.started` ends in a `run.finished`.
 */
export async function runSpec(options: RunSpecOptions, deps: RunSpecDeps): Promise<RunResult> {
  const { repoRoot, config, clock, reporter, signal } = deps;
  const lock = acquireLock(
    lockFile(repoRoot, options.spec),
    deps.pid ?? process.pid,
    deps.isAlive ?? isProcessAlive,
  );
  try {
    const branch =
      loadSpec(repoRoot, config, options.spec).spec.branch ?? `specrun/${options.spec}`;
    const { path: worktree } = await ensureWorktree({
      repoRoot,
      spec: options.spec,
      branch,
      base: options.base,
      setup: config.setup,
      run: deps.run,
      onProgress: (step) =>
        reporter.phase(
          step.step === 'add'
            ? { kind: 'worktree', path: relative(repoRoot, step.path) }
            : { kind: 'setup', command: step.command },
        ),
    });
    // The worktree's copy is what the agent sees and what the log describes.
    const loaded = loadSpec(worktree, config, options.spec);
    const { spec } = loaded;
    const eventsFile = join(loaded.dir, EVENTS_FILE);
    const progressFile = join(loaded.dir, PROGRESS_FILE);
    const logPaths = [relative(worktree, eventsFile), relative(worktree, progressFile)];
    // Outside the worktree: verify logs must never end up in a task commit.
    const logDir = join(repoRoot, '.specrun', 'logs', options.spec);
    const store = createEventStore({
      file: eventsFile,
      runId: randomUUID(),
      clock,
      onWarning: (message) => reporter.log('warn', message),
    });
    const git = createGit(worktree, deps.run);
    const protocol = loadProtocol();
    let latest: UsageSnapshot | null = null;
    // Warn once per failure streak: a dead probe would otherwise warn before every segment.
    let probeFailing = false;
    reporter.plan({ spec, events: store.read().events });

    const append = (event: NewEvent): SpecrunEvent => {
      const saved = store.append(event);
      reporter.event(saved);
      return saved;
    };
    const currentState = (): SpecState => deriveState(spec, store.read().events);
    const writeProgress = (state: SpecState): void =>
      writeFileSync(progressFile, renderProgress(spec, state));

    /** SRD-24: events and PROGRESS.md only, so uncommitted agent work stays out of it. */
    const commitRunLog = async (): Promise<string | null> => {
      writeProgress(currentState());
      const message = {
        subject: `chore(specrun): ${options.spec} run log`,
        body: '',
        trailers: config.commitTrailers,
      };
      return git.commitPaths(message, logPaths);
    };

    const wait = async (
      task: string,
      reason: WaitingUpdate['reason'],
      until: Date,
    ): Promise<void> => {
      append({ t: 'limit.wait', task, reason, until: until.toISOString() });
      reporter.waiting({ until, reason });
      await waitUntil(until, { clock, signal, onTick: () => reporter.waiting({ until, reason }) });
    };

    /** SRD-10: before each segment. Waits out a low session window; 'stop' on a low week. */
    const pauseCheck = async (task: string): Promise<'go' | 'stop'> => {
      for (;;) {
        const stale =
          latest === null || clock.now().getTime() - latest.at.getTime() > SNAPSHOT_MAX_AGE_MS;
        if (stale) {
          reporter.phase({ kind: 'usage' });
          const probed = await deps.probeUsage();
          if (probed !== null) {
            latest = probed;
            probeFailing = false;
            append(snapshotEvent(probed));
          } else if (!probeFailing) {
            probeFailing = true;
            reporter.log('warn', 'usage probe failed — running without limit data');
          }
        }
        const decision = decide(latest, config.limits, clock.now());
        if (decision.action === 'go') return 'go';
        if (decision.action === 'stop') return 'stop';
        await wait(task, decision.reason, decision.until);
        latest = null;
      }
    };

    /** SRD-12: recorded only, never enforced. */
    const budgetCheck = (task: SpecTask): void => {
      const totals = currentState().tasks.get(task.id)?.totals;
      if (totals === undefined) return;
      const size = config.sizes[task.size];
      const maxTurns = size.turns[1];
      if (totals.turns <= maxTurns && totals.costUsd <= size.usd) return;
      append({
        t: 'budget.exceeded',
        task: task.id,
        size: task.size,
        turns: totals.turns,
        costUsd: totals.costUsd,
        limit: { turns: maxTurns, usd: size.usd },
      });
    };

    const commitTask = async (
      task: SpecTask,
      payload: CompleteTaskPayload,
      sessionId: string | null,
    ): Promise<void> => {
      reporter.phase({ kind: 'commit', task: task.id });
      budgetCheck(task);
      writeProgress(previewDone(currentState(), task.id, payload));
      await git.addAll();
      const before = await git.head();
      const commit = await git.commit(
        buildCommitMessage({
          task: task.id,
          sessionId: sessionId ?? 'unknown',
          payload,
          trailers: config.commitTrailers,
        }),
      );
      const stat = await git.diffStat(before, commit);
      // Can't be part of the commit it names: goes into the next commit.
      append({ t: 'task.committed', task: task.id, commit, ...stat });
    };

    /** SRD-22: the log is committed first, so parking takes only the agent's work. */
    const blockTask = async (
      task: SpecTask,
      source: BlockSource,
      reason: string,
      kind?: string,
    ): Promise<void> => {
      budgetCheck(task);
      const ref = `refs/specrun/parked/${options.spec}/${task.id}`;
      const work = (await git.changedFiles('HEAD')).filter((file) => !logPaths.includes(file));
      append({
        t: 'task.blocked',
        task: task.id,
        reason,
        source,
        ...(kind === undefined ? {} : { kind }),
        ...(work.length === 0 ? {} : { parkedRef: ref }),
      });
      await commitRunLog();
      if (work.length > 0) await git.parkChanges(ref, `specrun: parked ${task.id}\n\n${reason}`);
      reporter.log('warn', `${task.id} blocked (${source}): ${reason}`);
    };

    /** SRD-6: the runner owns git — an agent commit is undone, its changes kept. */
    const checkHead = async (task: string, before: string): Promise<void> => {
      const after = await git.head();
      if (after === before) return;
      await git.resetSoft(before);
      append({
        t: 'protocol.violation',
        task,
        kind: 'agent-commit',
        detail: `HEAD moved ${before.slice(0, 7)} → ${after.slice(0, 7)}; soft-reset, changes kept`,
      });
    };

    /** One task through all its segments; null when it ended in a commit or a block. */
    const runTask = async (task: SpecTask, state: SpecState): Promise<RunEnd | null> => {
      const initial = state.tasks.get(task.id);
      if (initial === undefined) throw new Error(`unknown task ${task.id}`);
      const model = options.modelOverride ?? config.models[task.model];
      const crashed = initial.status === 'interrupted';
      const attempt = crashed ? Math.max(1, initial.attempts) : initial.attempts + 1;
      let sessionId = crashed ? initial.resumeSessionId : null;
      let segment = sessionId === null ? 0 : initial.nextSegment;
      let previous = sessionId === null ? null : cumulativeOf(state, task.id, sessionId);
      let next: { reason: SessionReason; prompt: string } = {
        reason: 'crash-resume',
        prompt: crashResumePrompt(),
      };
      let fixRounds = 0;
      let verifyRound = 0;

      for (;;) {
        if ((await pauseCheck(task.id)) === 'stop') {
          return { reason: 'paused-weekly', message: 'weekly usage left below the minimum' };
        }
        const current = currentState();
        let reason = next.reason;
        let prompt = next.prompt;
        let parts = NO_PARTS;
        // No session to resume (first segment, or the SDK never reported an id): start fresh.
        if (sessionId === null) {
          const built = buildPrompt({ spec: loaded, task, state: current, protocol });
          reason = 'start';
          prompt = built.text;
          parts = built.parts;
          segment = 0;
          previous = null;
        }
        reporter.phase({ kind: 'agent', task: task.id });
        append({
          t: 'session.started',
          task: task.id,
          sessionId,
          segment,
          attempt,
          model,
          reason,
          prompt: parts,
        });

        const base = current.tasks.get(task.id)?.totals ?? { turns: 0, costUsd: 0 };
        const seen: { snapshot: UsageSnapshot | null; turns: number } = {
          snapshot: null,
          turns: 0,
        };
        const observer: SessionObserver = {
          onToolUse: (tool, input) =>
            reporter.activity({ task: task.id, tool, detail: toolDetail(input) }),
          onUsage: (snapshot) => (seen.snapshot = snapshot),
          onTurn: (turn) => {
            seen.turns += 1;
            reporter.turn({
              task: task.id,
              turns: base.turns + seen.turns,
              context: turn.context,
              costUsd: base.costUsd,
            });
          },
        };
        const head = await git.head();
        const thisSegment = segment;
        const transcriptFile = (id: string): string =>
          join(
            config.transcriptsDir,
            basename(repoRoot),
            options.spec,
            task.id,
            `${id}-${thisSegment}.jsonl.gz`,
          );
        const result = await deps.session.run(
          {
            prompt,
            cwd: worktree,
            model,
            maxTurns: config.maxTurns,
            resumeSessionId: sessionId,
            previous,
            transcriptFile,
            signal,
          },
          observer,
        );
        append({
          t: 'session.finished',
          task: task.id,
          sessionId: result.sessionId ?? sessionId,
          segment,
          outcome: result.outcome,
          ...(result.error === null ? {} : { error: result.error }),
          ...result.stats,
        });
        const finishedId = result.sessionId ?? sessionId;
        if (finishedId !== null) {
          // Analytics are a by-product: a missing or broken transcript must not stop the run.
          try {
            recordAnalytics({
              store,
              transcriptFile: transcriptFile(finishedId),
              task: task.id,
              sessionId: finishedId,
              segment: thisSegment,
              reason,
              briefPath: loaded.briefPath(task.id),
            });
          } catch (error) {
            reporter.log('warn', `analytics for ${task.id} failed: ${errorMessage(error)}`);
          }
        }
        if (seen.snapshot !== null) {
          latest = seen.snapshot;
          append(snapshotEvent(seen.snapshot));
        }
        sessionId = result.sessionId ?? sessionId;
        previous = result.cumulative;
        segment += 1;
        await checkHead(task.id, head);

        switch (result.outcome) {
          case 'interrupted':
            return { reason: 'interrupted' };
          case 'limit': {
            const now = clock.now();
            const until =
              result.limitResetsAt === null
                ? limitHitTarget(latest, now)
                : waitTarget(result.limitResetsAt, now);
            await wait(task.id, 'limit-hit', until);
            latest = null;
            next = { reason: 'limit-resume', prompt: limitResumePrompt() };
            continue;
          }
          case 'no-call':
            if (reason === 'nudge') {
              await blockTask(
                task,
                'protocol',
                'ended without calling complete_task or block_task, also after a reminder',
              );
              return null;
            }
            next = { reason: 'nudge', prompt: noCallNudgePrompt() };
            continue;
          case 'blocked':
            if (result.toolCall?.tool === 'block_task') {
              const { reason: why, kind } = result.toolCall;
              await blockTask(task, 'agent', why, kind);
            } else {
              await blockTask(task, 'error', 'blocked without a block_task call');
            }
            return null;
          case 'max-turns':
            await blockTask(task, 'max-turns', `reached maxTurns (${config.maxTurns})`);
            return null;
          case 'error':
            await blockTask(task, 'error', result.error ?? 'session failed');
            return null;
          case 'completed':
            break;
        }

        if (result.toolCall?.tool !== 'complete_task') {
          await blockTask(task, 'error', 'completed without a complete_task call');
          return null;
        }
        const { payload } = result.toolCall;
        append({ t: 'task.completed', task: task.id, sessionId, payload });
        const logFile = join(logDir, `${task.id}-verify-${verifyRound}.log`);
        reporter.phase({ kind: 'verify', task: task.id });
        const verify = await runVerify({
          steps: config.verify,
          cwd: worktree,
          logFile,
          run: deps.run,
        });
        append({
          t: 'verify.finished',
          task: task.id,
          round: verifyRound,
          ok: verify.ok,
          durationMs: verify.durationMs,
          steps: verify.steps,
          log: logFile,
        });
        verifyRound += 1;
        if (verify.ok) {
          await commitTask(task, payload, sessionId);
          return null;
        }
        if (fixRounds < config.verifyFixRounds) {
          fixRounds += 1;
          next = {
            reason: 'verify-fix',
            prompt: verifyFailedPrompt(verify.summary, fixRounds, config.verifyFixRounds),
          };
          continue;
        }
        const failed = verify.steps.find((step) => !step.ok)?.name ?? 'verify';
        await blockTask(
          task,
          'verify',
          `verify step "${failed}" still failing after ${fixRounds} fix round(s); log: ${logFile}`,
        );
        return null;
      }
    };

    const notRunnable = (state: SpecState, id: string): string => {
      const task = spec.tasks.find((t) => t.id === id);
      if (task === undefined) return `Task ${id} is not in the spec`;
      const status = state.tasks.get(id)?.status ?? 'todo';
      const waiting = task.needs.filter((need) => state.tasks.get(need)?.status !== 'done');
      const detail = waiting.length > 0 ? `, waits for ${waiting.join(', ')}` : '';
      const hint = status === 'blocked' ? ' (use --retry-blocked)' : '';
      return `Task ${id} is not runnable: ${status}${detail}${hint}`;
    };

    const loop = async (): Promise<RunEnd> => {
      const startPhase = lowestOpenPhase(spec, currentState());
      // A task blocked in this run is not retried by `retryBlocked` in the same run.
      const attempted = new Set<string>();
      for (;;) {
        if (signal.aborted) return { reason: 'interrupted' };
        const state = currentState();
        const phase = lowestOpenPhase(spec, state);
        if (phase === null) return { reason: 'done' };
        const runnable = runnableTasks(spec, state, options).filter((t) => !attempted.has(t.id));
        let task: SpecTask | undefined;
        if (options.taskFilter !== undefined) {
          if (attempted.has(options.taskFilter)) return { reason: 'done' };
          task = runnable.find((t) => t.id === options.taskFilter);
          if (task === undefined) {
            return { reason: 'failed', message: notRunnable(state, options.taskFilter) };
          }
        } else {
          // SRD-8: a finished phase is a checkpoint.
          if (!options.allPhases && phase !== startPhase) {
            return { reason: 'checkpoint', message: `phase ${startPhase} finished` };
          }
          task = runnable.find((t) => options.allPhases || t.phase === phase);
          if (task === undefined) {
            const waiting = spec.tasks
              .filter((t) => state.tasks.get(t.id)?.status === 'todo')
              .map((t) => t.id);
            return {
              reason: 'done',
              message: `nothing runnable: ${waiting.join(', ')} wait for blocked tasks`,
            };
          }
        }
        attempted.add(task.id);
        const end = await runTask(task, state);
        if (end !== null) return end;
      }
    };

    append({
      t: 'run.started',
      spec: options.spec,
      branch,
      base: options.base,
      version: deps.version,
      options: {
        retryBlocked: options.retryBlocked,
        allPhases: options.allPhases,
        ...(options.taskFilter === undefined ? {} : { taskFilter: options.taskFilter }),
        ...(options.modelOverride === undefined ? {} : { modelOverride: options.modelOverride }),
      },
    });
    let end: RunEnd;
    try {
      end = await loop();
    } catch (error) {
      end =
        isAbort(error) || signal.aborted
          ? { reason: 'interrupted' }
          : { reason: 'failed', message: errorMessage(error) };
      if (end.reason === 'failed') reporter.log('error', errorMessage(error));
    }
    try {
      append({
        t: 'run.finished',
        reason: end.reason,
        ...(end.message === undefined ? {} : { message: end.message }),
      });
      await commitRunLog();
    } catch (error) {
      reporter.log('error', `could not record the end of the run: ${errorMessage(error)}`);
    }
    return {
      exitCode: EXIT_CODES[end.reason],
      reason: end.reason,
      ...(end.message === undefined ? {} : { message: end.message }),
    };
  } finally {
    lock.release();
  }
}
