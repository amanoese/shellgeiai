import { reportSolveProgress } from "../session/progress.js";
import { scoreShellgeiCandidate } from "../scoring/shellgeiScorer.js";
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

async function selectBestAttempt(session, task, attempts) {
  let bestAttempt = null;
  for (const attempt of attempts) {
    if (!attempt.passed) continue;
    const candidate = createWorkerCandidate({
      task, attempts, finalAttempt: attempt, finalReason: attempt.failureReason,
      engineName: session.engine.name
    });
    attempt.shellgeiScore = await scoreShellgeiCandidate(candidate, { mode: session.shellgeiScoreMode });
    if (!bestAttempt || attempt.shellgeiScore.value > bestAttempt.shellgeiScore.value) {
      bestAttempt = attempt;
    }
  }
  return bestAttempt;
}

export async function executeWorkerTask(session, task, control, workerState) {
  const attempts = [];
  let lastExplanation = "";
  let stopReason = "";
  let finalState = "idle";
  let bestAttempt = null;
  let baselineOutput;
  reportSolveProgress(session, {
    type: "worker-started",
    workerId: task.workerId,
    strategy: task.strategy,
    maxAttempts: task.maxAttempts
  });

  for (let iteration = 0; iteration < task.maxAttempts; iteration += 1) {
    const preflightStopReason = getWorkerStopReason(session, control, task.workerId);
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
      attempts,
      baselineOutput,
      bestCandidate: bestAttempt ? {
        attemptId: bestAttempt.attemptId,
        command: bestAttempt.command,
        shellgeiScore: bestAttempt.shellgeiScore
      } : undefined
    });

    lastExplanation = result.explanation ?? lastExplanation;
    if (result.attempt) {
      attempts.push(result.attempt);
    }

    if (result.state) {
      finalState = result.state;
    }

    if (result.passed) {
      baselineOutput ??= result.attempt.stdout.trim();
      if (session.selectorName === "first-pass-wins" && control.passingCandidateId == null && !control.stopRequested) {
        control.requestStop({
          reason: "Stopped after first passing candidate was produced.",
          passingCandidateId: task.workerId,
          exceptWorkerId: task.workerId,
          force: true
        });
      } else {
        control.passingCandidateId ??= task.workerId;
      }
    }

    if (attempts.some((attempt) => attempt.passed)) {
      bestAttempt = await selectBestAttempt(session, task, attempts);
    }

    if (result.stopReason) {
      stopReason = result.stopReason;
      break;
    }
  }

  if (session.signal?.aborted && (session.deadlineAtMs == null || Date.now() < session.deadlineAtMs)) {
    session.signal.throwIfAborted();
  }
  const finalAttempt = bestAttempt ?? attempts.at(-1);
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
  if (bestAttempt) candidate.shellgeiScore = bestAttempt.shellgeiScore;
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
