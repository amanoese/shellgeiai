import type { SolveSession, WorkerTask, WorkerState, WorkerResult, ExecutionControl, ExecutionSummary, ExecutionStopState } from "../types.js";

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
    let state: ExecutionStopState = { kind: "running", passingCandidateId: null };
    const deadlineReason = "Stopped because the overall time budget was exhausted.";
    const control: ExecutionControl = {
        get stopRequested() {
            return state.kind === "stopped";
        },
        get stopReason() {
            switch (state.kind) {
                case "running": return "";
                case "grace":
                case "deadline-observed":
                case "stopped": return state.reason;
                default: { const unreachable: never = state; return unreachable; }
            }
        },
        get passingCandidateId() {
            return state.passingCandidateId;
        },
        deadlineTimer: null,
        graceStopTimer: null,
        workers,
        requestStop(options) {
            if (control.graceStopTimer) {
                clearTimeout(control.graceStopTimer);
                control.graceStopTimer = null;
            }
            if (options.passingCandidateId) {
                control.recordPassingCandidate(options.passingCandidateId);
            }
            if (!options.force && state.kind === "stopped") {
                return;
            }
            state = { kind: "stopped", reason: options.reason, passingCandidateId: state.passingCandidateId };
            for (const workerState of control.workers.values()) {
                if (workerState.workerId === options.exceptWorkerId) {
                    continue;
                }
                if (!workerState.abortController.signal.aborted) {
                    workerState.abortController.abort();
                }
            }
        },
        scheduleGraceStop(options, delayMs) {
            if (control.stopRequested || control.graceStopTimer != null) {
                return;
            }
            if (options.passingCandidateId) {
                control.recordPassingCandidate(options.passingCandidateId);
            }
            // A synchronously observed deadline keeps its reason until a timer requests a stop.
            if (state.kind !== "deadline-observed") {
                state = { kind: "grace", reason: control.stopReason || options.reason, passingCandidateId: state.passingCandidateId };
            }
            control.graceStopTimer = setTimeout(() => {
                control.graceStopTimer = null;
                if (control.stopRequested) {
                    return;
                }
                control.requestStop(options);
            }, delayMs);
        },
        recordPassingCandidate(candidateId) {
            if (state.passingCandidateId == null) {
                state = { ...state, passingCandidateId: candidateId };
            }
        },
        createWorkerState(task) {
            return createWorkerState(task);
        },
        getStopReason() {
            if (state.kind === "stopped") {
                return state.reason || (state.passingCandidateId != null
                    ? `Stopped because ${state.passingCandidateId} already produced a passing candidate.`
                    : "Execution was stopped.");
            }
            if (session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs) {
                state = { kind: "deadline-observed", reason: deadlineReason, passingCandidateId: state.passingCandidateId };
                return state.reason;
            }
            return "";
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
            control.requestStop({
                reason: deadlineReason,
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
