#!/usr/bin/env node

import { createCliProgram, parseCliOptions } from "./cliOptions.js";
import { createSolveRuntime } from "./core/runtime.js";
import { solveProblem } from "./core/solve.js";
import { formatResult } from "./formatter/formatResult.js";

function printUsage() {
  process.stderr.write(`${createCliProgram().helpInformation()}\n`);
}

async function main() {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const runtime = createSolveRuntime({
      engine: options.engine,
      runner: options.runner
    });
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
      commandPolicyPath: options.commandPolicyPath,
      sandboxPolicyPath: options.sandboxPolicyPath
    });

    process.stdout.write(`${formatResult(result)}\n`);
    process.exitCode = result.finalCheck.passed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    printUsage();
    process.exitCode = 1;
  }
}

void main();
