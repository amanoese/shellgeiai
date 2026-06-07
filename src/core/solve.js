import path from "node:path";
import { isSafeCommand } from "../runner/safety.js";
import {
  createWorkingDirectory,
  ensureDirectory,
  parseProblemInput,
  writeJson
} from "../util/fs.js";

const DEFAULT_TIMEOUT_MS = 5_000;

export async function solveProblem(options) {
  const startedAt = new Date().toISOString();
  const problem = parseProblemInput(options.problemInput);
  const workdir = await createWorkingDirectory(options.requestedWorkdir);
  await ensureDirectory(path.join(process.cwd(), "logs"));

  const attempts = [];
  let lastExplanation = "";

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    const engineResult = await options.engine.generateCommand({
      problem: problem.problemText,
      attempts,
      workdir
    });
    lastExplanation = engineResult.explanation ?? lastExplanation;

    const safety = isSafeCommand(engineResult.command);
    if (!safety.safe) {
      attempts.push({
        command: engineResult.command,
        passed: false,
        failureReason: safety.reason,
        explanation: engineResult.explanation
      });
      break;
    }

    const runResult = await options.runner.run(engineResult.command, {
      cwd: workdir,
      timeoutMs: DEFAULT_TIMEOUT_MS
    });

    const decision = await options.judge.judge({
      command: engineResult.command,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      timedOut: runResult.timedOut
    });

    attempts.push({
      command: engineResult.command,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      timedOut: runResult.timedOut,
      passed: decision.passed,
      explanation: engineResult.explanation,
      failureReason: decision.reason
    });

    if (decision.passed) {
      return await finalizeSolve({
        problem,
        engineName: options.engine.name,
        workdir,
        attempts,
        explanation: engineResult.explanation ?? lastExplanation,
        startedAt,
        finalReason: decision.reason
      });
    }
  }

  const bestAttempt = attempts.at(-1);
  return await finalizeSolve({
    problem,
    engineName: options.engine.name,
    workdir,
    attempts,
    explanation: bestAttempt?.explanation ?? lastExplanation,
    startedAt,
    finalReason: bestAttempt?.failureReason ?? "No successful attempt."
  });
}

async function finalizeSolve(input) {
  const finishedAt = new Date().toISOString();
  const finalAttempt = input.attempts.at(-1);
  const finalCheck = {
    passed: finalAttempt?.passed ?? false,
    iterations: input.attempts.length,
    engine: input.engineName,
    reason: input.finalReason
  };

  const logId = finishedAt.replace(/[:.]/g, "-");
  const logPath = path.join(process.cwd(), "logs", `solve-${logId}.json`);
  await writeJson(logPath, {
    problem: input.problem.problemText,
    rawProblem: input.problem.raw,
    engine: input.engineName,
    iterations: input.attempts.length,
    attempts: input.attempts,
    startedAt: input.startedAt,
    finishedAt,
    workdir: input.workdir
  });

  return {
    command: finalAttempt?.command ?? "",
    output: finalAttempt?.stdout?.trimEnd() ?? "",
    explanation: input.explanation || "No explanation provided.",
    attempts: input.attempts,
    finalCheck,
    workdir: input.workdir,
    problem: input.problem,
    logPath
  };
}
