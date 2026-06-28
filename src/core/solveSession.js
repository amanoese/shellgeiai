import path from "node:path";
import { parseProblemInput } from "../io/problem/parseProblem.js";
import { createDefaultRunnerLimits } from "../execution/runner/limits.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../execution/safety/policyLoader.js";
import { ensureDirectory, resolveRequestedWorkdir } from "../shared/fs.js";
import { createExecutionPlan } from "./planner.js";
import { reportSessionPhase } from "./progress.js";

export async function createSolveSession(options) {
  const startedAt = new Date().toISOString();
  const sessionId = startedAt.replace(/[:.]/g, "-");
  const progressSession = {
    sessionId,
    onProgress: options.onProgress
  };

  reportSessionPhase(progressSession, "initializing", "Preparing session.");
  reportSessionPhase(progressSession, "problem-parsing", "Parsing problem input.");

  const problem = parseProblemInput(options.problemInput);
  const workdir = await resolveRequestedWorkdir(options.requestedWorkdir);
  const logsDir = path.join(process.cwd(), "logs");
  await ensureDirectory(logsDir);
  const commandPolicy = options.commandPolicy ?? (await loadCommandPolicy(options.commandPolicyPath));
  const sandboxPolicy = options.sandboxPolicy ?? (await loadSandboxPolicy(options.sandboxPolicyPath));
  const session = {
    sessionId,
    startedAt,
    startedAtMs: Date.now(),
    problem,
    workdir,
    logsDir,
    engine: options.engine,
    runner: options.runner,
    judge: options.judge,
    maxIterations: options.maxIterations,
    mode: options.mode ?? "single",
    parallelism: options.parallelism ?? 3,
    selectorName: options.selector ?? "first-pass-wins",
    shellgeiScoreMode: options.shellgeiScoreMode ?? "standard",
    timeBudgetMs: options.timeBudgetMs,
    deadlineAtMs: options.timeBudgetMs == null ? null : Date.now() + options.timeBudgetMs,
    runnerLimits: options.runnerLimits ?? createDefaultRunnerLimits(),
    writableWorkdir: options.writableWorkdir ?? false,
    commandPolicy,
    sandboxPolicy,
    onProgress: options.onProgress,
    plannerProvider: options.plannerProvider
  };

  reportSessionPhase(session, "planning", "Building execution plan.");
  const plan = await createExecutionPlan(session);

  return { ...session, plan };
}
