import { isSafeCommand } from "../safety/checker.js";
import { reportSolveProgress } from "./progress.js";

function buildJudgeInput(command, runResult, problem) {
  return {
    command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    expectedOutput: problem.expectedOutput
  };
}

function reportWorkerState(session, task, state) {
  reportSolveProgress(session, {
    type: "worker-state",
    workerId: task.workerId,
    strategy: task.strategy,
    state
  });
}

function getRemainingBudgetMs(session) {
  if (session.deadlineAtMs == null) {
    return undefined;
  }

  return Math.max(0, session.deadlineAtMs - Date.now());
}

function getStopReason(session, control) {
  if (control.stopRequested) {
    if (control.stopReason) {
      return control.stopReason;
    }

    if (control.passingCandidateId != null) {
      return `Stopped because ${control.passingCandidateId} already produced a passing candidate.`;
    }

    return "Execution was stopped.";
  }

  if (session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs) {
    control.stopReason = "Stopped because the overall time budget was exhausted.";
    return control.stopReason;
  }

  return "";
}

export async function executeWorkerTask(session, task, control, workerState, requestStop) {
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
    const preflightStopReason = getStopReason(session, control);
    if (preflightStopReason) {
      stopReason = preflightStopReason;
      reportWorkerState(session, task, "stopped");
      finalState = "stopped";
      break;
    }

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
    lastExplanation = engineResult.explanation ?? lastExplanation;
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
      finalState = "stopped";
      const attempt = {
        attemptId: `${task.workerId}-attempt-${iteration + 1}`,
        workerId: task.workerId,
        command: engineResult.command,
        passed: false,
        failureReason: safety.reason,
        explanation: engineResult.explanation,
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
      attempts.push(attempt);
      reportSolveProgress(session, {
        type: "attempt-finished",
        workerId: task.workerId,
        strategy: task.strategy,
        iteration: iteration + 1,
        command: engineResult.command,
        passed: false,
        reason: safety.reason
      });
      stopReason = safety.reason;
      break;
    }

    const remainingBudgetMs = getRemainingBudgetMs(session);
    if (remainingBudgetMs != null && remainingBudgetMs <= 0) {
      stopReason = getStopReason(session, control);
      reportWorkerState(session, task, "stopped");
      finalState = "stopped";
      break;
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
        const abortedReason = getStopReason(session, control) || "Execution was stopped.";
        reportWorkerState(session, task, "stopped");
        finalState = "stopped";
        const attempt = {
          attemptId: `${task.workerId}-attempt-${iteration + 1}`,
          workerId: task.workerId,
          command: engineResult.command,
          stdout: runResult.stdout,
          stderr: runResult.stderr,
          exitCode: runResult.exitCode,
          timedOut: runResult.timedOut,
          aborted: runResult.aborted ?? false,
          passed: false,
          explanation: engineResult.explanation,
          failureReason: abortedReason,
          durationMs: runResult.durationMs,
          runnerFailure: runResult.failure ?? null,
          runnerCleanup: runResult.cleanup ?? null,
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
        attempts.push(attempt);
        reportSolveProgress(session, {
          type: "attempt-finished",
          workerId: task.workerId,
          strategy: task.strategy,
          iteration: iteration + 1,
          command: engineResult.command,
          passed: false,
          reason: abortedReason
        });
        stopReason = abortedReason;
        break;
      }

      workerState.phase = "judging";
      reportWorkerState(session, task, "judging");
      const decision = await session.judge.judge(buildJudgeInput(engineResult.command, runResult, session.problem));
      const attempt = {
        attemptId: `${task.workerId}-attempt-${iteration + 1}`,
        workerId: task.workerId,
        command: engineResult.command,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        exitCode: runResult.exitCode,
        timedOut: runResult.timedOut,
        aborted: runResult.aborted ?? false,
        passed: decision.passed,
        explanation: engineResult.explanation,
        failureReason: decision.reason,
        durationMs: runResult.durationMs,
        score: decision.score,
        runnerFailure: runResult.failure ?? null,
        runnerCleanup: runResult.cleanup ?? null
      };

      attempts.push(attempt);
      reportSolveProgress(session, {
        type: "attempt-finished",
        workerId: task.workerId,
        strategy: task.strategy,
        iteration: iteration + 1,
        command: engineResult.command,
        passed: decision.passed,
        reason: decision.reason
      });
      if (decision.passed) {
        if (session.selectorName === "first-pass-wins") {
          control.scheduleGraceStop({
            reason: "Stopped after the first passing candidate was produced.",
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reportWorkerState(session, task, "stopped");
      finalState = "stopped";
      const attempt = {
        attemptId: `${task.workerId}-attempt-${iteration + 1}`,
        workerId: task.workerId,
        command: engineResult.command,
        passed: false,
        explanation: engineResult.explanation,
        failureReason: message,
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
      attempts.push(attempt);
      reportSolveProgress(session, {
        type: "attempt-finished",
        workerId: task.workerId,
        strategy: task.strategy,
        iteration: iteration + 1,
        command: engineResult.command,
        passed: false,
        reason: message
      });
      stopReason = message;
      break;
    } finally {
      workerState.phase = "idle";
      workerState.command = "";
    }
  }

  const finalAttempt = attempts.at(-1);
  const finalReason =
    finalAttempt?.passed
      ? finalAttempt.failureReason
      : stopReason ||
        finalAttempt?.failureReason ||
        (session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs
          ? "Time budget was exhausted before a successful attempt completed."
          : "No successful attempt.");
  const finalCheck = {
    passed: finalAttempt?.passed ?? false,
    iterations: attempts.length,
    engine: session.engine.name,
    reason: finalReason,
    score: finalAttempt?.score
  };

  const candidate = {
    candidateId: task.workerId,
    workerId: task.workerId,
    strategy: task.strategy,
    command: finalAttempt?.command ?? "",
    output: finalAttempt?.stdout?.trimEnd() ?? "",
    explanation: finalAttempt?.explanation ?? lastExplanation ?? "No explanation provided.",
    attempts,
    finalCheck
  };
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
    workerSummary: {
      workerId: task.workerId,
      strategy: task.strategy,
      strategyProfile: task.strategyProfile,
      attemptCount: attempts.length,
      passed: finalCheck.passed,
      state: finalState,
      reason: finalCheck.reason
    }
  };
}
