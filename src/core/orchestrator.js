import { executeWorkerTask } from "../worker/executeWorkerTask.js";
import { calculateWorkerConcurrency, createWorkerTaskQueue } from "../worker/taskQueue.js";
import { createExecutionControl } from "./executionControl.js";
import { createExecutionSummary } from "./executionSummary.js";
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

  const execution = createExecutionSummary({ results, taskOrder, control });
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
    const preflightStopReason = control.getStopReason();
    if (preflightStopReason) {
      return;
    }

    const task = queue.takeNext();
    if (!task) {
      return;
    }

    const workerState = control.createWorkerState(task);
    workers.set(task.workerId, workerState);
    try {
      const result = await executeWorkerTask(session, task, control, workerState);
      results.push(result);
    } finally {
      workers.delete(task.workerId);
    }
  }
}
