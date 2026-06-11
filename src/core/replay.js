import path from "node:path";
import { writeReplaySessionLog } from "../logs/writer.js";
import { createDefaultRunnerLimits } from "../runner/limits.js";
import { isSafeCommand } from "../safety/checker.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../safety/policyLoader.js";
import { createWorkingDirectory, ensureDirectory, readJson } from "../util/fs.js";

function buildZeroScore() {
  return {
    value: 0,
    breakdown: {
      correctness: 0,
      stdoutQuality: 0,
      stderrQuality: 0,
      expectedOutput: 0
    }
  };
}

function resolveReplayTarget(log, options) {
  if (options.attemptId) {
    const attempt = log.attempts?.find((item) => item.attemptId === options.attemptId);
    if (!attempt) {
      throw new Error(`Replay log did not contain attempt '${options.attemptId}'.`);
    }

    return {
      kind: "attempt",
      id: attempt.attemptId ?? options.attemptId,
      command: attempt.command,
      explanation: attempt.explanation ?? "Replayed an attempt from the session log."
    };
  }

  const candidateId = options.candidateId ?? log.selectedCandidateId ?? log.candidates?.[0]?.candidateId;
  const candidate = log.candidates?.find((item) => item.candidateId === candidateId);
  if (!candidate) {
    throw new Error("Replay log did not contain a candidate to rerun.");
  }

  return {
    kind: "candidate",
    id: candidate.candidateId,
    command: candidate.command,
    explanation: candidate.explanation ?? "Replayed a candidate from the session log."
  };
}

function buildProblemSpec(log, expectedOutputOverride) {
  const problemSpec = log.problemSpec ?? {
    raw: log.rawProblem ?? log.problem ?? "",
    problemText: log.problem ?? log.rawProblem ?? ""
  };

  return {
    ...problemSpec,
    expectedOutput: expectedOutputOverride ?? problemSpec.expectedOutput
  };
}

export async function replaySolveLog(options) {
  const startedAt = new Date().toISOString();
  const sessionId = startedAt.replace(/[:.]/g, "-");
  const logsDir = path.join(process.cwd(), "logs");
  await ensureDirectory(logsDir);

  const log = await readJson(options.logPath);
  const replayTarget = resolveReplayTarget(log, options);
  const problem = buildProblemSpec(log, options.expectedOutput);
  const workdir = await createWorkingDirectory(options.requestedWorkdir ?? log.workdir);
  const runnerLimits = options.runnerLimits ?? log.runner?.limits ?? createDefaultRunnerLimits();
  const commandPolicy = options.commandPolicy ?? (await loadCommandPolicy(options.commandPolicyPath));
  const sandboxPolicy = options.sandboxPolicy ?? (await loadSandboxPolicy(options.sandboxPolicyPath));
  const safetyCheck = isSafeCommand(replayTarget.command, commandPolicy);

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
      engine: "replay",
      reason: `Command was blocked by safety policy during replay: ${safetyCheck.reason}`,
      score: buildZeroScore()
    };
  } else {
    runResult = await options.runner.run(replayTarget.command, {
      cwd: workdir,
      timeoutMs: options.timeBudgetMs,
      limits: runnerLimits,
      sandboxPolicy
    });

    const decision = await options.judge.judge({
      command: replayTarget.command,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      timedOut: runResult.timedOut,
      expectedOutput: problem.expectedOutput
    });

    finalCheck = {
      passed: decision.passed,
      iterations: 1,
      engine: "replay",
      reason: decision.reason,
      score: decision.score
    };
  }

  const attempt = {
    attemptId: `replay-${replayTarget.id}`,
    workerId: "replay",
    command: replayTarget.command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    passed: finalCheck.passed,
    timedOut: runResult.timedOut,
    aborted: runResult.aborted ?? false,
    explanation: replayTarget.explanation,
    failureReason: finalCheck.passed ? undefined : finalCheck.reason,
    durationMs: runResult.durationMs,
    score: finalCheck.score,
    runnerFailure: runResult.failure ?? null,
    runnerCleanup: runResult.cleanup ?? null
  };
  const candidate = {
    candidateId: `replay-${replayTarget.id}`,
    workerId: "replay",
    strategy: `replay-${replayTarget.kind}`,
    command: replayTarget.command,
    output: runResult.stdout.trim(),
    explanation: replayTarget.explanation,
    attempts: [attempt],
    finalCheck
  };
  const stopReason = safetyCheck.safe
    ? `Completed replay for ${replayTarget.kind} '${replayTarget.id}'.`
    : `Stopped before replay because ${replayTarget.kind} '${replayTarget.id}' was blocked by safety policy.`;

  const { logPath } = await writeReplaySessionLog({
    logsDir,
    session: {
      sessionId,
      startedAt,
      sourceLogPath: options.logPath,
      sourceSelectedCandidateId: log.selectedCandidateId ?? null,
      workdir,
      runner: options.runner,
      runnerLimits,
      sandboxPolicy,
      problem,
      replayTarget
    },
    result: {
      attempts: [attempt],
      candidates: [candidate],
      finalCheck,
      stopReason
    }
  });

  return {
    command: replayTarget.command,
    output: runResult.stdout.trim(),
    explanation: replayTarget.explanation,
    attempts: [attempt],
    candidates: [candidate],
    finalCheck,
    selector: {
      name: "replay",
      reason: `Replayed ${replayTarget.kind} '${replayTarget.id}' from ${options.logPath}.`,
      selectedCandidateId: candidate.candidateId,
      score: finalCheck.score,
      metrics: null
    },
    runner: {
      name: options.runner.name ?? log.runner?.name ?? "local",
      image: "image" in options.runner ? options.runner.image : log.runner?.image,
      limits: runnerLimits,
      sandboxPolicy
    },
    stopReason,
    plan: {
      mode: "single",
      parallelism: 1,
      workerTasks: [
        {
          workerId: "replay",
          strategy: `replay-${replayTarget.kind}`,
          maxAttempts: 1
        }
      ]
    },
    workdir,
    problem,
    logPath
  };
}
