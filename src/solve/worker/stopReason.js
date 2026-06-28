export function getWorkerStopReason(session, control) {
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

export function getRemainingBudgetMs(session) {
  if (session.deadlineAtMs == null) {
    return undefined;
  }
  return Math.max(0, session.deadlineAtMs - Date.now());
}
