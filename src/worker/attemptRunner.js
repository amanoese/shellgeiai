import { reportSolveProgress } from "../solve/session/progress.js";
import { isSafeCommand } from "../execution/safety/checker.js";
import {
  buildJudgeInput,
  createAbortedAttempt,
  createJudgedAttempt,
  createUnsafeAttempt
} from "./attemptFactory.js";
import { getRemainingBudgetMs, getWorkerStopReason } from "./stopReason.js";

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

export async function runWorkerAttempt({ session, task, control, workerState, iteration, attempts }) {
  workerState.phase = "planning";
  reportWorkerState(session, task, "planning");
  const engineResult = await session.engine.generateCommand({
    problem: session.problem.problemText,
    attempts,
    workdir: session.workdir,
    workerId: task.workerId,
    strategy: task.strategy,
    workerTask: task
  });

  reportSolveProgress(session, {
    type: "attempt-started",
    workerId: task.workerId,
    strategy: task.strategy,
    iteration: iteration + 1,
    command: engineResult.command
  });

  const safety = isSafeCommand(engineResult.command, session.commandPolicy);
  if (!safety.safe) {
    reportWorkerState(session, task, "stopped");
    const attempt = createUnsafeAttempt({
      task,
      iteration,
      command: engineResult.command,
      explanation: engineResult.explanation,
      reason: safety.reason
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
  if (remainingBudgetMs != null && remainingBudgetMs <= 0) {
    const stopReason = getWorkerStopReason(session, control);
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
      signal: workerState.abortController.signal
    });

    if (runResult.aborted) {
      const abortedReason = getWorkerStopReason(session, control) || "Execution was stopped.";
      reportWorkerState(session, task, "stopped");
      const attempt = createAbortedAttempt({
        task,
        iteration,
        command: engineResult.command,
        runResult,
        explanation: engineResult.explanation,
        reason: abortedReason
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
    const decision = await session.judge.judge(buildJudgeInput(engineResult.command, runResult, session.problem));
    const attempt = createJudgedAttempt({
      task,
      iteration,
      command: engineResult.command,
      runResult,
      explanation: engineResult.explanation,
      decision
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
    const message = error instanceof Error ? error.message : String(error);
    reportWorkerState(session, task, "stopped");
    const attempt = createUnsafeAttempt({
      task,
      iteration,
      command: engineResult.command,
      explanation: engineResult.explanation,
      reason: message
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
