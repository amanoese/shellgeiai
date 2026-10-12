import type { SolveSession, WorkerTask, WorkerState, WorkerResult, ExecutionControl, ExecutionSummary, StopOptions } from "../types.js";

import { executeWorkerTask } from "./worker.js";
import { reportSessionPhase, reportSolveProgress } from "./events.js";

export async function runSolveOrchestrator(session: SolveSession): Promise<ExecutionSummary> {
    const workers = new Map<string, WorkerState>();
    const control = createExecutionControl(session, workers);
    const queue = createWorkerTaskQueue(session.plan.workerTasks);
    const taskOrder = new Map(session.plan.workerTasks.map((task, index) => [task.workerId, index]));
    const concurrency = calculateWorkerConcurrency(session.plan.workerTasks.length, session.plan.parallelism);
    const results: WorkerResult[] = [];
    reportSessionPhase(session, "executing", "Running worker tasks.");
    reportSolveProgress(session, {
        type: "session-started",
        parallelism: session.plan.parallelism,
        workerCount: session.plan.workerTasks.length
    });
    try {
        await Promise.all(Array.from({ length: concurrency }, () => runWorkerLoop(session, queue, control, workers, results)));
    }
    finally {
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

async function runWorkerLoop(session: SolveSession, queue: ReturnType<typeof createWorkerTaskQueue>, control: ExecutionControl, workers: Map<string, WorkerState>, results: WorkerResult[]) {
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
        }
        finally {
            workers.delete(task.workerId);
        }
    }
}

export function createExecutionControl(session: SolveSession, workers: Map<string, WorkerState>): ExecutionControl {
    const control: ExecutionControl = {
        stopRequested: false,
        stopReason: "",
        passingCandidateId: null,
        deadlineTimer: null,
        graceStopTimer: null,
        workers,
        requestStop(options) {
            requestStop(control, options);
        },
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
        createWorkerState(task) {
            return createWorkerState(task);
        },
        getStopReason() {
            return getStopReason(session, control);
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

function createWorkerState(task: WorkerTask): WorkerState {
    return {
        workerId: task.workerId,
        phase: "idle",
        iteration: 0,
        command: "",
        abortController: new AbortController()
    };
}

function requestStop(control: ExecutionControl, options: StopOptions) {
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

function getStopReason(session: SolveSession, control: ExecutionControl) {
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

export function createExecutionSummary({ results, taskOrder, control }: { results: WorkerResult[]; taskOrder: Map<string, number>; control: ExecutionControl }): ExecutionSummary {
    const orderedResults = [...results].sort((left, right) => {
        const leftOrder = taskOrder.get(left.candidate.workerId) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = taskOrder.get(right.candidate.workerId) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder;
    });
    return {
        attempts: orderedResults.flatMap((result) => result.attempts),
        candidates: orderedResults.map((result) => result.candidate),
        workerSummaries: orderedResults.map((result) => result.workerSummary),
        stopReason: control.stopReason || null,
        passingCandidateId: control.passingCandidateId,
        failedWorkerCount: orderedResults.filter((result) => !result.candidate.finalCheck.passed).length
    };
}

export function calculateWorkerConcurrency(workerTaskCount: number, requestedParallelism?: number) {
    const availableTasks = Math.max(0, workerTaskCount);
    const requestedWorkers = Math.max(1, requestedParallelism ?? 1);
    return Math.min(requestedWorkers, Math.max(1, availableTasks));
}

export function createWorkerTaskQueue(workerTasks: WorkerTask[]) {
    const queue = [...workerTasks];
    return {
        takeNext() {
            return queue.shift() ?? null;
        },
        isEmpty() {
            return queue.length === 0;
        },
        size() {
            return queue.length;
        }
    };
}
