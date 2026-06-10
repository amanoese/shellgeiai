import path from "node:path";
import { createExecutionPlan } from "./planner.js";
import { parseProblemInput } from "../problem/parseProblem.js";
import { createDefaultRunnerLimits } from "../runner/limits.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../safety/policyLoader.js";
import { createWorkingDirectory, ensureDirectory } from "../util/fs.js";

export async function createSolveSession(options) {
  const startedAt = new Date().toISOString();
  const problem = parseProblemInput(options.problemInput);
  const workdir = await createWorkingDirectory(options.requestedWorkdir);
  const logsDir = path.join(process.cwd(), "logs");
  await ensureDirectory(logsDir);
  const commandPolicy = options.commandPolicy ?? (await loadCommandPolicy(options.commandPolicyPath));
  const sandboxPolicy = options.sandboxPolicy ?? (await loadSandboxPolicy(options.sandboxPolicyPath));

  const session = {
    sessionId: startedAt.replace(/[:.]/g, "-"),
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
    parallelism: options.parallelism ?? 1,
    selectorName: options.selector ?? "first-pass-wins",
    timeBudgetMs: options.timeBudgetMs,
    deadlineAtMs: options.timeBudgetMs == null ? null : Date.now() + options.timeBudgetMs,
    runnerLimits: options.runnerLimits ?? createDefaultRunnerLimits(),
    commandPolicy,
    sandboxPolicy
  };

  return {
    ...session,
    plan: createExecutionPlan(session)
  };
}
