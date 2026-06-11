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

export async function runSolveOrchestrator(session) {
  const workers = new Map();
  const control = createExecutionControl(session, workers);
  const queue = [...session.plan.workerTasks];
  const taskOrder = new Map(session.plan.workerTasks.map((task, index) => [task.workerId, index]));
  const workerCount = Math.max(1, session.plan.parallelism ?? queue.length ?? 1);
  const concurrency = Math.min(workerCount, Math.max(1, queue.length));
  const results = [];
  reportSolveProgress(session, {
    type: "session-started",
    parallelism: session.plan.parallelism,
    workerCount: queue.length
  });

  try {
    await Promise.all(Array.from({ length: concurrency }, () => runWorkerLoop(session, queue, control, workers, results)));
  } finally {
    control.dispose();
  }

  results.sort((left, right) => {
    const leftOrder = taskOrder.get(left.candidate.workerId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = taskOrder.get(right.candidate.workerId) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });

  const execution = {
    attempts: results.flatMap((result) => result.attempts),
    candidates: results.map((result) => result.candidate),
    stopReason: control.stopReason || null,
    passingCandidateId: control.passingCandidateId
  };
  reportSolveProgress(session, {
    type: "session-finished",
    attemptCount: execution.attempts.length,
    candidateCount: execution.candidates.length,
    stopReason: execution.stopReason,
    selectedCandidateId: execution.passingCandidateId ?? null
  });

  return execution;
}

async function runWorkerLoop(session, queue, control, workers, results) {
  while (queue.length > 0) {
    const preflightStopReason = getStopReason(session, control);
    if (preflightStopReason) {
      return;
    }

    const task = queue.shift();
    if (!task) {
      return;
    }

    const workerState = createWorkerState(task);
    workers.set(task.workerId, workerState);
    try {
      const result = await runWorkerTask(session, task, control, workerState);
      results.push(result);
    } finally {
      workers.delete(task.workerId);
    }
  }
}

async function runWorkerTask(session, task, control, workerState) {
  const attempts = [];
  let lastExplanation = "";
  let stopReason = "";
  reportSolveProgress(session, {
    type: "worker-started",
    workerId: task.workerId,
    strategy: task.strategy
  });

  for (let iteration = 0; iteration < task.maxAttempts; iteration += 1) {
    const preflightStopReason = getStopReason(session, control);
    if (preflightStopReason) {
      stopReason = preflightStopReason;
      break;
    }

    workerState.phase = "planning";
    const engineResult = await session.engine.generateCommand({
      problem: session.problem.problemText,
      attempts,
      workdir: session.workdir,
      workerId: task.workerId,
      strategy: task.strategy
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
      break;
    }

    try {
      workerState.phase = "running";
      workerState.iteration = iteration + 1;
      workerState.command = engineResult.command;

      const runResult = await session.runner.run(engineResult.command, {
        cwd: session.workdir,
        timeoutMs: remainingBudgetMs,
        limits: session.runnerLimits,
        sandboxPolicy: session.sandboxPolicy,
        signal: workerState.abortController.signal
      });

      if (runResult.aborted) {
        const abortedReason = getStopReason(session, control) || "Execution was stopped.";
        const attempt = {
          attemptId: `${task.workerId}-attempt-${iteration + 1}`,
          workerId: task.workerId,
          command: engineResult.command,
          stdout: runResult.stdout,
          stderr: runResult.stderr,
          exitCode: runResult.exitCode,
          timedOut: runResult.timedOut,
          passed: false,
          explanation: engineResult.explanation,
          failureReason: abortedReason,
          durationMs: runResult.durationMs,
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
      const decision = await session.judge.judge(buildJudgeInput(engineResult.command, runResult, session.problem));
      const attempt = {
        attemptId: `${task.workerId}-attempt-${iteration + 1}`,
        workerId: task.workerId,
        command: engineResult.command,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        exitCode: runResult.exitCode,
        timedOut: runResult.timedOut,
        passed: decision.passed,
        explanation: engineResult.explanation,
        failureReason: decision.reason,
        durationMs: runResult.durationMs,
        score: decision.score
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
          requestStop(control, {
            reason: "Stopped after the first passing candidate was produced.",
            passingCandidateId: task.workerId,
            exceptWorkerId: task.workerId,
            force: true
          });
        } else {
          control.passingCandidateId ??= task.workerId;
        }
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    candidate
  };
}

function createExecutionControl(session, workers) {
  const control = {
    stopRequested: false,
    stopReason: "",
    passingCandidateId: null,
    deadlineTimer: null,
    workers,
    dispose() {
      if (control.deadlineTimer) {
        clearTimeout(control.deadlineTimer);
      }
    }
  };

  if (session.deadlineAtMs != null) {
    const delayMs = Math.max(0, session.deadlineAtMs - Date.now());
    control.deadlineTimer = setTimeout(() => {
      requestStop(control, {
        reason: "Stopped because the overall time budget was exhausted.",
        force: true
      });
    }, delayMs);
  }

  return control;
}

function createWorkerState(task) {
  return {
    workerId: task.workerId,
    phase: "idle",
    iteration: 0,
    command: "",
    abortController: new AbortController()
  };
}

function requestStop(control, options) {
  if (options.passingCandidateId && control.passingCandidateId == null) {
    control.passingCandidateId = options.passingCandidateId;
  }

  if (!options.force && control.stopRequested) {
    return;
  }

  control.stopRequested = true;
  control.stopReason = options.reason;
  if (control.workers) {
    for (const workerState of control.workers.values()) {
      if (workerState.workerId === options.exceptWorkerId) {
        continue;
      }

      if (!workerState.abortController.signal.aborted) {
        workerState.abortController.abort();
      }
    }
  }
}

function getRemainingBudgetMs(session) {
  if (session.deadlineAtMs == null) {
    return undefined;
  }

  return Math.max(0, session.deadlineAtMs - Date.now());
}

function getStopReason(session, control) {
  if (control.stopRequested) {
    if (control.passingCandidateId != null) {
      return `Stopped because ${control.passingCandidateId} already produced a passing candidate.`;
    }

    return control.stopReason || "Execution was stopped.";
  }

  if (session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs) {
    control.stopReason = "Stopped because the overall time budget was exhausted.";
    return control.stopReason;
  }

  return "";
}
