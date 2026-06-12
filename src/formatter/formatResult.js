function formatJudgeBreakdown(score) {
  return `correctness=${score?.breakdown?.correctness ?? 0}, stdout=${score?.breakdown?.stdoutQuality ?? 0}, stderr=${score?.breakdown?.stderrQuality ?? 0}, expected=${score?.breakdown?.expectedOutput ?? 0}`;
}

function formatShellgeiBreakdown(score) {
  return `conciseness=${score?.breakdown?.conciseness ?? 0}, shellness=${score?.breakdown?.shellness ?? 0}, ingenuity=${score?.breakdown?.ingenuity ?? 0}, readability=${score?.breakdown?.readability ?? 0}, robustness=${score?.breakdown?.robustness ?? 0}, artistry=${score?.breakdown?.artistry ?? 0}`;
}

function formatWorkerVariantLines(result) {
  const workerTasks = result.plan?.workerTasks ?? [];
  const candidates = result.candidates ?? [];

  if (workerTasks.length === 0) {
    return ["(none)"];
  }

  return workerTasks.map((task) => {
    const candidate = candidates.find(
      (entry) => entry.workerId === task.workerId || entry.candidateId === task.workerId
    );

    return [
      task.workerId,
      task.assignedVariant?.label ?? "(no-variant)",
      task.assignedVariant?.approach ?? "(no-approach)",
      candidate?.command ?? "(no-command)"
    ].join(" | ");
  });
}

export function formatResult(result) {
  const status = result.finalCheck.passed ? "passed" : "failed";
  const selectedScore = result.selector?.score;
  const selectedCandidate = result.candidates?.find(
    (candidate) => candidate.candidateId === result.selector?.selectedCandidateId
  );
  const selectedShellgeiScore = selectedCandidate?.shellgeiScore;
  const selectorMetrics = result.selector?.metrics;
  const passingCandidates = (result.candidates ?? []).filter((candidate) => candidate.finalCheck?.passed);
  const plannerInfo = result.plan?.planner ?? null;
  const workerVariantLines = formatWorkerVariantLines(result);

  return [
    "COMMAND:",
    result.command || "(none)",
    "",
    "EXPLANATION:",
    result.explanation || "(none)",
    "",
    "CHECK:",
    `status: ${status}`,
    `iterations: ${result.finalCheck.iterations}`,
    `engine: ${result.finalCheck.engine}`,
    `workers: ${result.candidates?.length ?? 0}`,
    `stop-reason: ${result.stopReason ?? "(none)"}`,
    `selector: ${result.selector?.name ?? "first-pass-wins"}`,
    `selected-candidate: ${result.selector?.selectedCandidateId ?? "(none)"}`,
    `selected-score: ${selectedScore?.value ?? 0}`,
    `score-breakdown: ${formatJudgeBreakdown(selectedScore)}`,
    `selected-shellgei-score: ${selectedShellgeiScore?.value ?? 0}`,
    `shellgei-breakdown: ${formatShellgeiBreakdown(selectedShellgeiScore)}`,
    `shellgei-notes: ${selectedShellgeiScore?.notes?.join("; ") || "(none)"}`,
    `shellgei-penalties: ${selectedShellgeiScore?.penalties?.join("; ") || "(none)"}`,
    `selector-reason: ${result.selector?.reason ?? "(none)"}`,
    `selector-metrics: total=${selectorMetrics?.totalScore ?? 0}, shellgei=${selectorMetrics?.shellgeiScore ?? 0}, judge=${selectorMetrics?.judgeScore ?? 0}, consensus=${selectorMetrics?.outputConsensus ?? 0}, stdout=${selectorMetrics?.stdoutConsistency ?? 0}, duration=${selectorMetrics?.totalDurationMs ?? 0}, iterations=${selectorMetrics?.iterationCount ?? 0}, command-length=${selectorMetrics?.commandLength ?? 0}, explanation-length=${selectorMetrics?.explanationLength ?? 0}`,
    `planner-provider: ${plannerInfo?.provider ?? "(unknown)"}`,
    `planner-attempted-provider: ${plannerInfo?.attemptedProvider ?? "(unknown)"}`,
    `planner-fallback-reason: ${plannerInfo?.fallbackReason ?? "(none)"}`,
    `passing-candidates: ${passingCandidates.length}`,
    "",
    "WORKER VARIANTS:",
    ...workerVariantLines,
    "",
    "RUNNER:",
    `name: ${result.runner?.name ?? "(unknown)"}`,
    `sandbox: ${JSON.stringify(result.runner?.sandboxPolicy ?? {})}`,
    "",
    "LOG:",
    result.logPath ?? "(none)"
  ].join("\n");
}
