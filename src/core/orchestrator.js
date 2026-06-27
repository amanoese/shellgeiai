import { executeWorkerTask } from "../worker/taskExecutor.js";
import { calculateWorkerConcurrency, createWorkerTaskQueue } from "../worker/taskQueue.js";
import { reportSessionPhase, reportSolveProgress } from "./progress.js";

export async function runSolveOrchestrator(session) {
  const workers = new Map();
  const control = createExecutionControl(session, workers);
  const queue = createWorkerTaskQueue(session.plan.workerTasks);
  const taskOrder = new Map(session.plan.workerTasks.map((task, index) => [task.workerId, index]));
  const concurrency = calculateWorkerConcurrency(session.plan.workerTasks.length, session.plan.parallelism);
  const results = [];

  reportSessionPhase(session, "executing", "Running worker tasks.");
  reportSolveProgress(session, {
    type: "session-started",
    parallelism: session.plan.parallelism,
    workerCount: session.plan.workerTasks.length
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
    workerSummaries: results.map((result) => result.workerSummary),
    stopReason: control.stopReason || null,
    passingCandidateId: control.passingCandidateId,
    failedWorkerCount: results.filter((result) => !result.candidate.finalCheck.passed).length
  };
  reportSolveProgress(session, {
    type: "session-finished",
    attemptCount: execution.attempts.length,
    candidateCount: execution.candidates.length,
    failedWorkerCount: execution.failedWorkerCount,
    stopReason: execution.stopReason,
    selectedCandidateId: execution.passingCandidateId ?? null
  });

  return execution;
}

async function runWorkerLoop(session, queue, control, workers, results) {
  while (!queue.isEmpty()) {
    const preflightStopReason = getStopReason(session, control);
    if (preflightStopReason) {
      return;
    }

    const task = queue.takeNext();
    if (!task) {
      return;
    }

    const workerState = createWorkerState(task);
    workers.set(task.workerId, workerState);
    try {
      const result = await executeWorkerTask(session, task, control, workerState);
      results.push(result);
    } finally {
      workers.delete(task.workerId);
    }
  }
}

function createExecutionControl(session, workers) {
  const control = {
    stopRequested: false,
    stopReason: "",
    passingCandidateId: null,
    deadlineTimer: null,
    graceStopTimer: null,
    workers,
    scheduleGraceStop(options, delayMs) {
      if (control.stopRequested || control.graceStopTimer != null) {
        return;
      }

      if (!control.stopReason) {
        control.stopReason = options.reason;
      }

      if (options.passingCandidateId && control.passingCandidateId == null) {
        control.passingCandidateId = options.passingCandidateId;
      }

      control.graceStopTimer = setTimeout(() => {
        control.graceStopTimer = null;
        if (control.stopRequested) {
          return;
        }

        requestStop(control, options);
      }, delayMs);
    },
    dispose() {
      if (control.deadlineTimer) {
        clearTimeout(control.deadlineTimer);
        control.deadlineTimer = null;
      }

      if (control.graceStopTimer) {
        clearTimeout(control.graceStopTimer);
        control.graceStopTimer = null;
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
  if (control.graceStopTimer) {
    clearTimeout(control.graceStopTimer);
    control.graceStopTimer = null;
  }

  if (options.passingCandidateId && control.passingCandidateId == null) {
    control.passingCandidateId = options.passingCandidateId;
  }

  if (!options.force && control.stopRequested) {
    return;
  }

  control.stopRequested = true;
  control.stopReason = options.reason;
  for (const workerState of control.workers.values()) {
    if (workerState.workerId === options.exceptWorkerId) {
      continue;
    }

    if (!workerState.abortController.signal.aborted) {
      workerState.abortController.abort();
    }
  }
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
