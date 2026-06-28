export function createExecutionSummary({ results, taskOrder, control }) {
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
