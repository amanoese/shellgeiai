import path from "node:path";
import { writeCheckSessionLog } from "../logs/writer.js";
import { createDefaultRunnerLimits } from "../runner/limits.js";
import { isSafeCommand } from "../safety/checker.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../safety/policyLoader.js";
import { createWorkingDirectory, ensureDirectory } from "../util/fs.js";

export async function checkCommand(options) {
  const startedAt = new Date().toISOString();
  const sessionId = startedAt.replace(/[:.]/g, "-");
  const logsDir = path.join(process.cwd(), "logs");
  await ensureDirectory(logsDir);

  const workdir = await createWorkingDirectory(options.requestedWorkdir);
  const runnerLimits = options.runnerLimits ?? createDefaultRunnerLimits();
  const commandPolicy = options.commandPolicy ?? (await loadCommandPolicy(options.commandPolicyPath));
  const sandboxPolicy = options.sandboxPolicy ?? (await loadSandboxPolicy(options.sandboxPolicyPath));
  const expectedOutput = options.expectedOutput;
  const problemText = options.problem ?? options.command;
  const safetyCheck = isSafeCommand(options.command, commandPolicy);

  let runResult = {
    stdout: "",
    stderr: "",
    exitCode: null,
    timedOut: false,
    aborted: false,
    durationMs: 0,
    failure: null
  };
  let finalCheck;

  if (!safetyCheck.safe) {
    finalCheck = {
      passed: false,
      iterations: 0,
      engine: "manual-check",
      reason: `Command was blocked by safety policy: ${safetyCheck.reason}`,
      score: {
        value: 0,
        breakdown: {
          correctness: 0,
          stdoutQuality: 0,
          stderrQuality: 0,
          expectedOutput: 0
        }
      }
    };
  } else {
    runResult = await options.runner.run(options.command, {
      cwd: workdir,
      timeoutMs: options.timeBudgetMs,
      limits: runnerLimits,
      sandboxPolicy
    });

    const decision = await options.judge.judge({
      command: options.command,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      timedOut: runResult.timedOut,
      expectedOutput
    });

    finalCheck = {
      passed: decision.passed,
      iterations: 1,
      engine: "manual-check",
      reason: decision.reason,
      score: decision.score
    };
  }

  const attempt = {
    attemptId: "check-1",
    workerId: "check",
    command: options.command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    passed: finalCheck.passed,
    timedOut: runResult.timedOut,
    aborted: runResult.aborted ?? false,
    explanation: "Checked an explicit command.",
    failureReason: finalCheck.passed ? undefined : finalCheck.reason,
    durationMs: runResult.durationMs,
    score: finalCheck.score,
    runnerFailure: runResult.failure ?? null,
    runnerCleanup: runResult.cleanup ?? null
  };
  const candidate = {
    candidateId: "check-1",
    workerId: "check",
    strategy: "manual-check",
    command: options.command,
    output: runResult.stdout.trim(),
    explanation: "Checked an explicit command.",
    attempts: [attempt],
    finalCheck
  };
  const stopReason = safetyCheck.safe
    ? "Completed explicit command check."
    : "Stopped before execution because the command was blocked by safety policy.";

  const { logPath } = await writeCheckSessionLog({
    logsDir,
    session: {
      sessionId,
      startedAt,
      workdir,
      runner: options.runner,
      runnerLimits,
      sandboxPolicy,
      commandPolicyPath: options.commandPolicyPath,
      problemText,
      expectedOutput
    },
    result: {
      command: options.command,
      attempts: [attempt],
      candidates: [candidate],
      finalCheck,
      stopReason
    }
  });

  return {
    command: options.command,
    output: runResult.stdout.trim(),
    explanation: "Checked an explicit command.",
    attempts: [attempt],
    candidates: [candidate],
    finalCheck,
    selector: {
      name: "manual-check",
      reason: "Checked the provided command directly.",
      selectedCandidateId: candidate.candidateId,
      score: finalCheck.score,
      metrics: null
    },
    runner: {
      name: options.runner.name ?? "local",
      image: "image" in options.runner ? options.runner.image : undefined,
      limits: runnerLimits,
      sandboxPolicy
    },
    stopReason,
    plan: {
      mode: "single",
      parallelism: 1,
      workerTasks: [
        {
          workerId: "check",
          strategy: "manual-check",
          maxAttempts: 1
        }
      ]
    },
    workdir,
    problem: {
      raw: problemText,
      problemText,
      expectedOutput,
      metadata: {
        format: "plain-text"
      }
    },
    logPath
  };
}
