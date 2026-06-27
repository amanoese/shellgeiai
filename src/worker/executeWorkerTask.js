import { reportSolveProgress } from "../core/progress.js";
import { createWorkerCandidate, createWorkerSummary } from "./attemptFactory.js";
import { runWorkerAttempt } from "./attemptRunner.js";
import { getWorkerStopReason } from "./stopReason.js";

function reportWorkerState(session, task, state) {
  reportSolveProgress(session, {
    type: "worker-state",
    workerId: task.workerId,
    strategy: task.strategy,
    state
  });
}

export async function executeWorkerTask(session, task, control, workerState) {
  const attempts = [];
  let lastExplanation = "";
  let stopReason = "";
  let finalState = "idle";
  reportSolveProgress(session, {
    type: "worker-started",
    workerId: task.workerId,
    strategy: task.strategy,
    maxAttempts: task.maxAttempts
  });

  for (let iteration = 0; iteration < task.maxAttempts; iteration += 1) {
    const preflightStopReason = getWorkerStopReason(session, control);
    if (preflightStopReason) {
      stopReason = preflightStopReason;
      reportWorkerState(session, task, "stopped");
      finalState = "stopped";
      break;
    }

    const result = await runWorkerAttempt({
      session,
      task,
      control,
      workerState,
      iteration,
      attempts
    });

    lastExplanation = result.explanation ?? lastExplanation;
    if (result.attempt) {
      attempts.push(result.attempt);
    }

    if (result.state) {
      finalState = result.state;
    }

    if (result.passed) {
      if (session.selectorName === "first-pass-wins") {
        control.scheduleGraceStop({
          reason: "Stopped after first passing candidate was produced.",
          passingCandidateId: task.workerId,
          exceptWorkerId: task.workerId,
          force: true
        }, 5_000);
      } else {
        control.passingCandidateId ??= task.workerId;
      }
      finalState = "idle";
      break;
    }

    if (result.stopReason) {
      stopReason = result.stopReason;
      break;
    }
  }

  const finalAttempt = attempts.at(-1);
  const finalReason = finalAttempt?.passed
    ? finalAttempt.failureReason
    : stopReason ||
      finalAttempt?.failureReason ||
      (session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs
        ? "Time budget was exhausted before successful attempt completed."
        : "No successful attempt.");
  const candidate = createWorkerCandidate({
    task,
    attempts,
    finalAttempt,
    finalReason,
    lastExplanation,
    engineName: session.engine.name
  });
  const finalCheck = candidate.finalCheck;
  const workerSummary = createWorkerSummary({ task, attempts, finalCheck, finalState });
  reportSolveProgress(session, {
    type: "worker-finished",
    workerId: task.workerId,
    strategy: task.strategy,
    attemptCount: attempts.length,
    passed: finalCheck.passed,
    reason: finalCheck.reason
  });

  return {
    attempts,
    candidate,
    workerSummary
  };
}
