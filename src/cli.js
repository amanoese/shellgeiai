#!/usr/bin/env node

import { createCliProgram, parseCliOptions } from "./cliOptions.js";
import { solveProblem } from "./core/solve.js";
import { CodexCliEngine } from "./engines/codexCliEngine.js";
import { CursorCliEngine } from "./engines/cursorCliEngine.js";
import { MockEngine } from "./engines/mockEngine.js";
import { formatResult } from "./formatter/formatResult.js";
import { SimpleJudge } from "./judge/simpleJudge.js";
import { LocalRunner } from "./runner/localRunner.js";

function printUsage() {
  process.stderr.write(`${createCliProgram().helpInformation()}\n`);
}

function createEngine(name) {
  switch (name) {
    case "mock":
      return new MockEngine();
    case "codex":
      return new CodexCliEngine();
    case "cursor":
      return new CursorCliEngine();
    default:
      throw new Error(`Unsupported engine: ${String(name)}`);
  }
}

async function main() {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const result = await solveProblem({
      problemInput: options.problem,
      engine: createEngine(options.engine),
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: options.maxIter,
      requestedWorkdir: options.workdir
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
