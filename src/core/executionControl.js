export function createExecutionControl(session, workers) {
  const control = {
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
