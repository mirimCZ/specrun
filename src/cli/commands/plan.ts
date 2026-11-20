import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Config } from '../../config/configSchema.js';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import type { PlanMetrics } from '../../events/eventSchema.js';
import { createEventStore, readEvents } from '../../events/eventStore.js';
import { createGit } from '../../git/git.js';
import {
  claudeConfigDir,
  findClaudeTranscript,
  readPlanMetrics,
} from '../../plan/claudeTranscript.js';
import { readPlanCommitMessage } from '../../plan/planCommit.js';
import { planLaunchArgs, renderPlanContext } from '../../plan/planContext.js';
import { createPlanFolder, resolvePlanFolder } from '../../plan/specFolder.js';
import {
  runCommand,
  runInteractive,
  type InteractiveRunner,
  type ProcessRunner,
} from '../../process/run.js';
import { formatTokens } from '../../progress/renderProgress.js';
import { loadSpec, SPEC_FILE } from '../../spec/loadSpec.js';
import { accountForSession } from '../accountsFor.js';
import { activeSpecFiles, type CliDeps } from '../cliDeps.js';

/** Seams for tests: the Claude Code process, git, the exit code, the session id and the config dir. */
export interface PlanOverrides {
  launch?: InteractiveRunner;
  run?: ProcessRunner;
  setExitCode?: (code: number) => void;
  newSessionId?: () => string;
  claudeConfigDir?: string;
}

export interface PlanFlags {
  name: string;
  file?: string;
  resume?: boolean;
  print?: boolean;
  account?: string;
}

function summaryLine(metrics: PlanMetrics | null): string {
  if (metrics === null) return 'Planning session: no transcript found';
  return (
    `Planning session: ${metrics.turns} turns, ${formatTokens(metrics.inputTokens)} in / ` +
    `${formatTokens(metrics.outputTokens)} out, cache read ${formatTokens(metrics.cacheRead)}, ` +
    `peak context ${formatTokens(metrics.peakContext)}`
  );
}

export async function runPlan(
  flags: PlanFlags,
  repoRoot: string,
  deps: CliDeps,
  overrides: PlanOverrides = {},
): Promise<number | null> {
  const config = loadConfig(repoRoot);
  const folder = resolvePlanFolder(repoRoot, config, flags.name);
  const { spec } = folder;
  const resume = flags.resume === true;
  const print = flags.print === true;

  const request = flags.file === undefined ? null : readRequest(flags.file, deps.cwd);
  const files = folder.created
    ? []
    : readdirSync(folder.dir, { withFileTypes: true })
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
  const contextFile = join(repoRoot, '.specrun', 'plan', `${spec}.md`);
  const commitMessageFile = join(repoRoot, '.specrun', 'plan', `${spec}.commit`);
  const context = renderPlanContext({
    spec,
    dir: relative(repoRoot, folder.dir),
    files,
    specsDir: config.specsDir,
    request,
    featureMap: existsSync(join(repoRoot, config.featuresDir, 'README.md'))
      ? join(config.featuresDir, 'README.md')
      : null,
    commitMessageFile: relative(repoRoot, commitMessageFile),
  });

  const eventsFile = activeSpecFiles(repoRoot, config, spec).eventsFile;
  let sessionId: string;
  if (resume) {
    const earlier = existsSync(eventsFile)
      ? readEvents(eventsFile).events.findLast((e) => e.t === 'plan.session')
      : undefined;
    if (earlier?.t !== 'plan.session') {
      throw new SpecrunError('spec-invalid', `No earlier planning session for ${spec}`, [
        `start one with: specrun plan -n ${flags.name}`,
      ]);
    }
    sessionId = earlier.sessionId;
  } else {
    sessionId = (overrides.newSessionId ?? randomUUID)();
  }
  const { args, message } = planLaunchArgs(
    resume
      ? { kind: 'resume', spec, sessionId, contextFile }
      : { kind: 'new', spec, sessionId, contextFile },
  );

  if (print) {
    deps.stdout(`${context}\n---\n\n${message}\n`);
    return 0;
  }
  if (!deps.interactive) {
    throw new SpecrunError('terminal-required', 'specrun plan needs a terminal', [
      'run it in a terminal, or use --print for the text',
    ]);
  }

  // MAD-15: the token is resolved before anything is written; an error ends the command here.
  const account = await accountForSession(repoRoot, config, flags.account, deps);

  if (folder.created) createPlanFolder(folder);
  mkdirSync(join(repoRoot, '.specrun', 'plan'), { recursive: true });
  writeFileSync(contextFile, context);
  // A proposal left by an earlier session would describe an older state of the spec.
  rmSync(commitMessageFile, { force: true });
  deps.stdout(`Planning ${spec} with Claude — context in ${relative(repoRoot, contextFile)}\n`);

  const result = await (overrides.launch ?? runInteractive)('claude', args, {
    cwd: repoRoot,
    env: account.env ?? deps.env,
  });
  if (result.error !== null) {
    throw new SpecrunError('claude-missing', 'Could not start claude', [
      result.error,
      'install Claude Code (https://claude.com/claude-code), or use --print',
    ]);
  }

  const metrics = readMetrics(sessionId, overrides, deps);
  createEventStore({
    file: eventsFile,
    runId: `plan-${sessionId}`,
    clock: { now: deps.now },
  }).append({
    t: 'plan.session',
    sessionId,
    resumed: resume,
    exitCode: result.code,
    metrics,
  });
  deps.stdout(`${summaryLine(metrics)}\n`);
  if (!existsSync(join(folder.dir, SPEC_FILE))) {
    deps.stdout(`No tasks.yaml yet — specrun plan -n ${flags.name} continues\n`);
    return result.code;
  }
  await commitSpec(
    repoRoot,
    config,
    folder.dir,
    spec,
    sessionId,
    commitMessageFile,
    overrides.run ?? runCommand,
    deps,
  );
  return result.code;
}

/**
 * Commits only the spec folder (incl. the `plan.session` event) on the checked-out HEAD, so the
 * run sees it and a later merge can't collide with an uncommitted events.jsonl. The message is the
 * skill's proposal when it wrote one — the CLI commits because the event is written after Claude
 * exits. An invalid spec stays uncommitted; a failing commit only warns — the session is done.
 */
async function commitSpec(
  repoRoot: string,
  config: Config,
  dir: string,
  spec: string,
  sessionId: string,
  commitMessageFile: string,
  run: ProcessRunner,
  deps: CliDeps,
): Promise<void> {
  try {
    loadSpec(repoRoot, config, spec);
  } catch (error) {
    if (!(error instanceof SpecrunError)) throw error;
    deps.stderr(`warning: ${error.message} — not committed\n`);
    deps.stdout(
      `Fix it (specrun status ${spec}), then commit the spec folder before specrun run\n`,
    );
    return;
  }
  const relDir = relative(repoRoot, dir);
  const git = createGit(repoRoot, run);
  try {
    const proposed = readPlanCommitMessage(commitMessageFile);
    const fallback = async (): Promise<string> =>
      `docs(${spec}): ${(await git.hasPath('HEAD', relDir)) ? 'update' : 'plan'} spec`;
    const commit = await git.commitPaths(
      {
        subject: proposed?.subject ?? (await fallback()),
        body: proposed?.body ?? '',
        trailers: [`Specrun-Plan-Session: ${sessionId}`, ...config.commitTrailers],
      },
      [relDir],
    );
    if (commit !== null) rmSync(commitMessageFile, { force: true });
    deps.stdout(
      commit === null
        ? `Spec folder unchanged, nothing to commit — next: specrun run ${spec}\n`
        : `Committed ${relDir} (commit ${commit.slice(0, 7)}) — next: specrun run ${spec}\n`,
    );
  } catch (error) {
    if (!(error instanceof SpecrunError)) throw error;
    deps.stderr(
      `warning: could not commit ${relDir}: ${[error.message, ...error.details].join(' — ')}\n`,
    );
    deps.stdout(`Commit the spec folder (incl. events.jsonl) before specrun run\n`);
  }
}

function readRequest(file: string, cwd: string): string {
  try {
    return readFileSync(resolve(cwd, file), 'utf8');
  } catch (error) {
    throw new SpecrunError('spec-invalid', `Cannot read request file ${file}`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

function readMetrics(
  sessionId: string,
  overrides: PlanOverrides,
  deps: CliDeps,
): PlanMetrics | null {
  try {
    const configDir = overrides.claudeConfigDir ?? claudeConfigDir(deps.env, homedir());
    const transcript = findClaudeTranscript(sessionId, configDir);
    if (transcript !== null) return readPlanMetrics(transcript);
    deps.stderr(`warning: no Claude Code transcript found for session ${sessionId}\n`);
  } catch (error) {
    deps.stderr(
      `warning: cannot read the transcript of session ${sessionId}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
  return null;
}

export function register(program: Command, deps: CliDeps, overrides: PlanOverrides = {}): void {
  program
    .command('plan')
    .description('Plan a spec with Claude Code, on this terminal')
    .requiredOption('-n, --name <name>', 'spec name without number, e.g. plan-command')
    .option('-f, --file <request.md>', 'file with the request, handed to Claude verbatim')
    .option('--resume', 'continue the spec’s latest planning session')
    .option('--print', 'print what Claude would get instead of starting it')
    .option('--account <name>', 'start Claude on this account (default: the priority account)')
    .action(async (flags: PlanFlags) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const code = await runPlan(flags, repoRoot, deps, overrides);
      if (code !== null && flags.print !== true) {
        (overrides.setExitCode ?? ((c) => void (process.exitCode = c)))(code);
      }
    });
}
