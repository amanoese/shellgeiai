import { reportSolveProgress } from "../session/progress.js";
import { isSafeCommand } from "../../execution/safety/checker.js";
import {
  buildJudgeInput,
  createAbortedAttempt,
  createGenerationFailedAttempt,
  createJudgedAttempt,
  createUnsafeAttempt
} from "./attemptFactory.js";
import { getRemainingBudgetMs, getWorkerStopReason } from "./stopReason.js";
import { generateWorkerCommand, WorkerToolLoopError } from "./toolLoop.js";

function reportWorkerState(session, task, state) {
  reportSolveProgress(session, {
    type: "worker-state",
    workerId: task.workerId,
    strategy: task.strategy,
    state
  });
}

function reportAttemptFinished(session, task, iteration, command, passed, reason) {
  reportSolveProgress(session, {
    type: "attempt-finished",
    workerId: task.workerId,
    strategy: task.strategy,
    iteration: iteration + 1,
    command,
    passed,
    reason
  });
}

function getRoutineCancellationReason({ error, signal, session, control }) {
  if (!signal.aborted || (
    error !== signal.reason && error?.name !== "AbortError" && error?.name !== "APIUserAbortError"
  )) return "";
  const deadlineExceeded = session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs;
  // An external session cancellation is an exception; scheduler/deadline stops preserve candidates.
  if (session.signal?.aborted && !deadlineExceeded) return "";
  return getWorkerStopReason(session, control) || "Execution was stopped.";
}

function throwIfExternalSessionAborted(session) {
  if (session.signal?.aborted && (
    session.deadlineAtMs == null || Date.now() < session.deadlineAtMs
  )) session.signal.throwIfAborted();
}

function createStoppedGenerationResult({ session, task, workerState, reason, engineResult }) {
  workerState.phase = "idle";
  reportWorkerState(session, task, "stopped");
  return {
    attempt: undefined,
    state: "stopped",
    stopReason: reason,
    explanation: engineResult?.explanation ?? "",
    command: engineResult?.command ?? "",
    passed: false,
    reason
  };
}

export async function runWorkerAttempt({ session, task, control, workerState, iteration, attempts, bestCandidate, baselineOutput }) {
  const signal = session.signal
    ? AbortSignal.any([workerState.abortController.signal, session.signal])
    : workerState.abortController.signal;
  workerState.phase = "planning";
  reportWorkerState(session, task, "planning");
  const context = {
    problem: session.problem.problemText,
    attempts,
    workdir: session.workdir,
    workerId: task.workerId,
    strategy: task.strategy,
    workerTask: task,
    bestCandidate
  };
  let generated;
  try {
    generated = await generateWorkerCommand({
      engine: session.engine,
      context,
      toolRegistry: session.toolRegistry,
      signal
    });
  } catch (error) {
    const cancellationReason = getRoutineCancellationReason({ error, signal, session, control });
    if (cancellationReason) {
      return createStoppedGenerationResult({ session, task, workerState, reason: cancellationReason });
    }
    if (!(error instanceof WorkerToolLoopError) && !bestCandidate) {
      throw error;
    }
    throwIfExternalSessionAborted(session);
    // Unexpected provider errors may contain request details or credentials.
    const message = error instanceof WorkerToolLoopError
      ? error.message
      : "Command generation failed during improvement.";

    const attempt = createGenerationFailedAttempt({
      task,
      iteration,
      reason: message,
      toolCalls: error?.toolCalls ?? []
    });
    workerState.phase = "idle";
    reportWorkerState(session, task, "idle");
    reportAttemptFinished(session, task, iteration, "", false, message);
    return {
      attempt,
      state: "idle",
      stopReason: error instanceof WorkerToolLoopError ? "" : message,
      explanation: "",
      command: "",
      passed: false,
      reason: message
    };
  }
  const { engineResult, toolCalls } = generated;

  reportSolveProgress(session, {
    type: "attempt-started",
    workerId: task.workerId,
    strategy: task.strategy,
    iteration: iteration + 1,
    command: engineResult.command
  });

  const safety = await isSafeCommand(engineResult.command, session.commandPolicy);
  if (!safety.safe) {
    reportWorkerState(session, task, "stopped");
    const attempt = createUnsafeAttempt({
      task,
      iteration,
      command: engineResult.command,
      explanation: engineResult.explanation,
      reason: safety.reason,
      toolCalls
    });
    reportAttemptFinished(session, task, iteration, engineResult.command, false, safety.reason);
    return {
      attempt,
      state: "stopped",
      stopReason: safety.reason,
      explanation: engineResult.explanation,
      command: engineResult.command,
      passed: false,
      reason: safety.reason
    };
  }

  const remainingBudgetMs = getRemainingBudgetMs(session);
  if (signal.aborted) {
    const cancellationReason = getRoutineCancellationReason({ error: signal.reason, signal, session, control });
    if (cancellationReason) {
      return createStoppedGenerationResult({ session, task, workerState, reason: cancellationReason, engineResult });
    }
    signal.throwIfAborted();
  }
  if (remainingBudgetMs != null && remainingBudgetMs <= 0) {
    const stopReason = getWorkerStopReason(session, control, task.workerId);
    reportWorkerState(session, task, "stopped");
    return {
      attempt: undefined,
      state: "stopped",
      stopReason,
      explanation: engineResult.explanation,
      command: engineResult.command,
      passed: false,
      reason: stopReason
    };
  }

  try {
    workerState.phase = "running";
    workerState.iteration = iteration + 1;
    workerState.command = engineResult.command;
    reportWorkerState(session, task, "running");

    const runResult = await session.runner.run(engineResult.command, {
      cwd: session.workdir,
      timeoutMs: remainingBudgetMs,
      limits: session.runnerLimits,
      sandboxPolicy: session.sandboxPolicy,
      dockerDevicesReadonly: session.dockerDevicesReadonly,
      signal
    });
    throwIfExternalSessionAborted(session);

    if (runResult.aborted) {
      const abortedReason = getWorkerStopReason(session, control) || "Execution was stopped.";
      reportWorkerState(session, task, "stopped");
      const attempt = createAbortedAttempt({
        task,
        iteration,
        command: engineResult.command,
        runResult,
        explanation: engineResult.explanation,
        reason: abortedReason,
        toolCalls
      });
      reportAttemptFinished(session, task, iteration, engineResult.command, false, abortedReason);
      return {
        attempt,
        state: "stopped",
        stopReason: abortedReason,
        explanation: engineResult.explanation,
        command: engineResult.command,
        passed: false,
        reason: abortedReason
      };
    }

    workerState.phase = "judging";
    reportWorkerState(session, task, "judging");
    let decision = await session.judge.judge(buildJudgeInput(engineResult.command, runResult, session.problem));
    if (decision.passed && baselineOutput !== undefined && session.problem.expectedOutput === undefined &&
        runResult.stdout.trim() !== baselineOutput) {
      const breakdown = decision.score?.breakdown;
      const mismatchBreakdown = breakdown ? { ...breakdown, correctness: 0, expectedOutput: 0 } : null;
      decision = {
        ...decision,
        passed: false,
        reason: "Output did not match the first passing attempt.",
        ...(mismatchBreakdown ? { score: {
          ...decision.score,
          value: Object.values(mismatchBreakdown).reduce((sum, value) => sum + value, 0),
          breakdown: mismatchBreakdown
        } } : {}),
        ...(decision.gate ? { gate: { ...decision.gate, disqualified: true, expectedOutputMatched: false } } : {})
      };
    }
    const attempt = createJudgedAttempt({
      task,
      iteration,
      command: engineResult.command,
      runResult,
      explanation: engineResult.explanation,
      decision,
      toolCalls
    });
    reportAttemptFinished(session, task, iteration, engineResult.command, decision.passed, decision.reason);
    return {
      attempt,
      state: "idle",
      stopReason: "",
      explanation: engineResult.explanation,
      command: engineResult.command,
      passed: decision.passed,
      reason: decision.reason
    };
  } catch (error) {
    throwIfExternalSessionAborted(session);
    const message = error instanceof Error ? error.message : String(error);
    reportWorkerState(session, task, "stopped");
    const attempt = createUnsafeAttempt({
      task,
      iteration,
      command: engineResult.command,
      explanation: engineResult.explanation,
      reason: message,
      toolCalls
    });
    reportAttemptFinished(session, task, iteration, engineResult.command, false, message);
    return {
      attempt,
      state: "stopped",
      stopReason: message,
      explanation: engineResult.explanation,
      command: engineResult.command,
      passed: false,
      reason: message
    };
  } finally {
    workerState.phase = "idle";
    workerState.command = "";
  }
}
