import { createProgressReporter } from "../../io/formatter/progressReporter.js";
import { formatResult } from "../../io/formatter/formatResult.js";
import { createSolveRuntime } from "../../solve/runtime.js";
import { solveProblem } from "../../solve/solve.js";

export async function runSolveCommand(options) {
  const progressReporter = createProgressReporter(options.progress);
  try {
    const runtime = createSolveRuntime({
      engine: options.engine,
      runner: options.runner,
      llm: {
        baseURL: options.llmBaseUrl,
        model: options.llmModel,
        plannerModel: options.plannerModel,
        timeoutMs: options.llmTimeout,
        maxRetries: options.llmMaxRetries
      }
    });
    const result = await solveProblem({
      problemInput: options.problem,
      engine: runtime.engine,
      runner: runtime.runner,
      judge: runtime.judge,
      plannerProvider: runtime.plannerProvider,
      llmConfig: runtime.llmConfig,
      maxIterations: options.maxIter,
      requestedWorkdir: options.workdir,
      mode: options.mode,
      parallelism: options.parallelism,
      selector: options.selector,
      timeBudgetMs: options.timeBudget,
      writableWorkdir: options.writableWorkdir,
      dockerDevicesReadonly: options.dockerDevicesReadonly,
      commandPolicyPath: options.commandPolicy,
      sandboxPolicyPath: options.sandboxPolicy,
      knowledgeMode: options.knowledge,
      knowledgeModel: options.knowledgeModel,
      knowledgeDatasetPath: options.knowledgeDataset,
      knowledgeDbPath: options.knowledgeDb,
      onProgress: progressReporter
    });

    process.stdout.write(`${formatResult(result)}\n`);
    process.exitCode = result.finalCheck.passed ? 0 : 1;
  } finally {
    progressReporter?.cleanup?.();
  }
}
