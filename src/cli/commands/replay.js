import { formatResult } from "../../io/formatter/formatResult.js";
import { replaySolveLog } from "../../core/replay.js";
import { createSolveRuntime } from "../../core/runtime.js";

export async function runReplayCommand(options) {
  const runtime = createSolveRuntime({
    runner: options.runner
  });
  const result = await replaySolveLog({
    logPath: options.logPath,
    candidateId: options.candidateId,
    attemptId: options.attemptId,
    expectedOutput: options.expectedOutput,
    requestedWorkdir: options.workdir,
    writableWorkdir: options.writableWorkdir,
    timeBudgetMs: options.timeBudgetMs,
    commandPolicyPath: options.commandPolicyPath,
    sandboxPolicyPath: options.sandboxPolicyPath,
    runner: runtime.runner,
    judge: runtime.judge
  });

  process.stdout.write(`${formatResult(result)}\n`);
  process.exitCode = result.finalCheck.passed ? 0 : 1;
}
