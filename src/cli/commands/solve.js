import { createProgressReporter } from "../../io/formatter/progressReporter.js";
import { formatResult } from "../../io/formatter/formatResult.js";
import { createSolveRuntime } from "../../solve/runtime.js";
import { solveProblem } from "../../solve/solve.js";

export async function runSolveCommand(options) {
  const progressReporter = createProgressReporter(options.progress);
  const runtime = createSolveRuntime({
    engine: options.engine,
    runner: options.runner
  });

  try {
    const result = await solveProblem({
      problemInput: options.problem,
      engine: runtime.engine,
      runner: runtime.runner,
      judge: runtime.judge,
      maxIterations: options.maxIter,
      requestedWorkdir: options.workdir,
      mode: options.mode,
      parallelism: options.parallelism,
      selector: options.selector,
      timeBudgetMs: options.timeBudgetMs,
      writableWorkdir: options.writableWorkdir,
      commandPolicyPath: options.commandPolicyPath,
      sandboxPolicyPath: options.sandboxPolicyPath,
      knowledgeMode: options.knowledgeMode,
      knowledgeModel: options.knowledgeModel,
      knowledgeDatasetPath: options.knowledgeDatasetPath,
      knowledgeVectorsPath: options.knowledgeVectorsPath,
      onProgress: progressReporter
    });

    process.stdout.write(`${formatResult(result)}\n`);
    process.exitCode = result.finalCheck.passed ? 0 : 1;
  } finally {
    progressReporter?.cleanup?.();
  }
}
