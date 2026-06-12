import { formatResult } from "../../formatter/formatResult.js";
import { checkCommand } from "../../core/check.js";
import { createSolveRuntime } from "../../core/runtime.js";

export async function runCheckCommand(options) {
  const runtime = createSolveRuntime({
    runner: options.runner
  });
  const result = await checkCommand({
    command: options.shellCommand,
    problem: options.problem,
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
