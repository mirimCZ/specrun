import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import type { Command } from 'commander';
import { findRepoRoot, loadConfig } from '../../config/loadConfig.js';
import { SpecrunError } from '../../errors.js';
import type { PlanMetrics } from '../../events/eventSchema.js';
import { createEventStore, readEvents } from '../../events/eventStore.js';
import {
  claudeConfigDir,
  findClaudeTranscript,
  readPlanMetrics,
} from '../../plan/claudeTranscript.js';
import { planLaunchArgs, renderPlanContext } from '../../plan/planContext.js';
import { createPlanFolder, resolvePlanFolder } from '../../plan/specFolder.js';
import { runInteractive, type InteractiveRunner } from '../../process/run.js';
import { formatTokens } from '../../progress/renderProgress.js';
import { SPEC_FILE } from '../../spec/loadSpec.js';
import { activeSpecFiles, type CliDeps } from '../cliDeps.js';

/** Seams for tests: the Claude Code process, the exit code, the session id and the config dir. */
export interface PlanOverrides {
  launch?: InteractiveRunner;
  setExitCode?: (code: number) => void;
  newSessionId?: () => string;
  claudeConfigDir?: string;
}

export interface PlanFlags {
  name: string;
  file?: string;
  resume?: boolean;
  print?: boolean;
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
  const context = renderPlanContext({
    spec,
    dir: relative(repoRoot, folder.dir),
    files,
    specsDir: config.specsDir,
    request,
    featureMap: existsSync(join(repoRoot, config.featuresDir, 'README.md'))
      ? join(config.featuresDir, 'README.md')
      : null,
  });
  const contextFile = join(repoRoot, '.specrun', 'plan', `${spec}.md`);

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

  if (folder.created) createPlanFolder(folder);
  mkdirSync(join(repoRoot, '.specrun', 'plan'), { recursive: true });
  writeFileSync(contextFile, context);
  deps.stdout(`Planning ${spec} with Claude — context in ${relative(repoRoot, contextFile)}\n`);

  const result = await (overrides.launch ?? runInteractive)('claude', args, {
    cwd: repoRoot,
    env: deps.env,
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
  deps.stdout(
    existsSync(join(folder.dir, SPEC_FILE))
      ? `Next: specrun status ${spec} — commit the spec folder (incl. events.jsonl) before specrun run\n`
      : `No tasks.yaml yet — specrun plan -n ${flags.name} continues\n`,
  );
  return result.code;
}

function readRequest(file: string, cwd: string): string {
  try {
    return readFileSync(join(cwd, file), 'utf8');
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
    .action(async (flags: PlanFlags) => {
      const repoRoot = findRepoRoot(deps.cwd);
      const code = await runPlan(flags, repoRoot, deps, overrides);
      if (code !== null && flags.print !== true) {
        (overrides.setExitCode ?? ((c) => void (process.exitCode = c)))(code);
      }
    });
}
