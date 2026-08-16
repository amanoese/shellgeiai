function createZeroScore() {
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

export function createAttemptId(task, iteration) {
  return `${task.workerId}-attempt-${iteration + 1}`;
}

export function buildJudgeInput(command, runResult, problem) {
  return {
    command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    expectedOutput: problem.expectedOutput
  };
}

export function createUnsafeAttempt({ task, iteration, command, explanation, reason, toolCalls = [] }) {
  return {
    attemptId: createAttemptId(task, iteration),
    workerId: task.workerId,
    command,
    passed: false,
    failureReason: reason,
    explanation,
    score: createZeroScore(),
    toolCalls
  };
}

export function createAbortedAttempt({
  task,
  iteration,
  command,
  runResult,
  explanation,
  reason,
  toolCalls = []
}) {
  return {
    attemptId: createAttemptId(task, iteration),
    workerId: task.workerId,
    command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    aborted: runResult.aborted ?? false,
    passed: false,
    explanation,
    failureReason: reason,
    durationMs: runResult.durationMs,
    runnerFailure: runResult.failure ?? null,
    runnerCleanup: runResult.cleanup ?? null,
    score: createZeroScore(),
    toolCalls
  };
}

export function createJudgedAttempt({
  task,
  iteration,
  command,
  runResult,
  explanation,
  decision,
  toolCalls = []
}) {
  return {
    attemptId: createAttemptId(task, iteration),
    workerId: task.workerId,
    command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    aborted: runResult.aborted ?? false,
    passed: decision.passed,
    explanation,
    failureReason: decision.reason,
    durationMs: runResult.durationMs,
    score: decision.score,
    runnerFailure: runResult.failure ?? null,
    runnerCleanup: runResult.cleanup ?? null,
    toolCalls
  };
}

export function createGenerationFailedAttempt({ task, iteration, reason, toolCalls = [] }) {
  return {
    attemptId: createAttemptId(task, iteration),
    workerId: task.workerId,
    command: "",
    stdout: "",
    stderr: "",
    exitCode: null,
    timedOut: false,
    aborted: false,
    passed: false,
    explanation: "",
    failureReason: reason,
    durationMs: 0,
    runnerFailure: null,
    runnerCleanup: null,
    score: createZeroScore(),
    state: "idle",
    stopReason: "",
    toolCalls
  };
}

export function createWorkerCandidate({
  task,
  attempts,
  finalAttempt,
  finalReason,
  lastExplanation,
  engineName
}) {
  return {
    candidateId: task.workerId,
    workerId: task.workerId,
    strategy: task.strategy,
    command: finalAttempt?.command ?? "",
    output: finalAttempt?.stdout?.trimEnd() ?? "",
    explanation: finalAttempt?.explanation ?? lastExplanation ?? "No explanation provided.",
    attempts,
    finalCheck: {
      passed: finalAttempt?.passed ?? false,
      iterations: attempts.length,
      engine: engineName,
      reason: finalReason,
      score: finalAttempt?.score
    }
  };
}

export function createWorkerSummary({ task, attempts, finalCheck, finalState }) {
  return {
    workerId: task.workerId,
    strategy: task.strategy,
    strategyProfile: task.strategyProfile,
    attemptCount: attempts.length,
    passed: finalCheck.passed,
    state: finalState,
    reason: finalCheck.reason
  };
}
