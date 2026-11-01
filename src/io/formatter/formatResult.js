import { SHELLGEI_SCORE_VERSION } from "../../solve/scoring/shellgeiScorer.js";

function formatScoreNumber(value) {
  if (!Number.isFinite(value)) return "(unscored)";
  return value > 0 && value < 0.01 ? value.toExponential(5) : value.toFixed(2);
}

function formatJudgeBreakdown(score) {
  return `correctness=${score?.breakdown?.correctness ?? 0}, stdout=${score?.breakdown?.stdoutQuality ?? 0}, stderr=${score?.breakdown?.stderrQuality ?? 0}, expected=${score?.breakdown?.expectedOutput ?? 0}`;
}

function formatShellgeiBreakdown(score, currentScoring) {
  if (currentScoring && !score) return "(unscored)";
  if (score?.version === SHELLGEI_SCORE_VERSION) {
    const breakdown = score.breakdown;
    return `characters=${breakdown.commandLength}, artistry=${formatScoreNumber(breakdown.artistry)}, effective-length=${formatScoreNumber(breakdown.effectiveLength)}, shellness-reference=${formatScoreNumber(breakdown.shellness)}, readability-reference=${formatScoreNumber(breakdown.readability)}`;
  }
  return `conciseness=${score?.breakdown?.conciseness ?? 0}, shellness=${score?.breakdown?.shellness ?? 0}, ingenuity=${score?.breakdown?.ingenuity ?? 0}, readability=${score?.breakdown?.readability ?? 0}, robustness=${score?.breakdown?.robustness ?? 0}, artistry=${score?.breakdown?.artistry ?? 0}`;
}

function formatSelectorMetrics(metrics, currentScoring) {
  if (!metrics) return "selector-metrics: (none)";
  const score = currentScoring ? formatScoreNumber : (value) => value ?? 0;
  return `selector-metrics: ${[
    `total=${score(metrics.totalScore)}`,
    `shellgei=${score(metrics.shellgeiScore)}`,
    `judge=${metrics.judgeScore ?? 0}`,
    `consensus=${metrics.outputConsensus ?? 0}`,
    `stdout=${metrics.stdoutConsistency ?? 0}`,
    `duration=${metrics.totalDurationMs ?? 0}`,
    `iterations=${metrics.iterationCount ?? 0}`,
    `command-length=${metrics.commandLength ?? 0}`,
    `explanation-length=${metrics.explanationLength ?? 0}`
  ].join(", ")}`;
}

function formatWorkerVariantLines(result, currentScoring) {
  const workerTasks = result.plan?.workerTasks ?? [];
  const candidates = result.candidates ?? [];
  const knowledgeMode = result.knowledgeMode ?? result.plan?.knowledgeMode ?? "off";

  if (workerTasks.length === 0) {
    return ["(none)"];
  }

  return workerTasks.map((task) => {
    const candidate = candidates.find(
      (entry) => entry.workerId === task.workerId || entry.candidateId === task.workerId
    );
    const score = currentScoring
      ? formatScoreNumber(candidate?.shellgeiScore?.value)
      : candidate?.shellgeiScore?.value ?? candidate?.finalCheck?.score?.value ?? candidate?.score?.value ?? 0;
    const toolBias = task.assignedVariant?.toolBias ?? [];

    return [
      task.workerId,
      `score: ${score}`,
      `knowledge: ${knowledgeMode}`,
      `[${toolBias.join(",")}]`,
      candidate?.command ?? "(no-command)"
    ].join(" # ");
  });
}

export function formatResult(result) {
  const status = result.finalCheck?.passed ? "passed" : "failed";
  const selectedScore = result.selector?.score;
  const selectedCandidate = result.candidates?.find(
    (candidate) => candidate.candidateId === result.selector?.selectedCandidateId
  );
  const selectedShellgeiScore = selectedCandidate?.shellgeiScore;
  const scoringVersion = result.shellgeiScoreVersion ?? selectedShellgeiScore?.version;
  const currentScoring = scoringVersion === SHELLGEI_SCORE_VERSION;
  const selectorMetrics = result.selector?.metrics;
  const passingCandidates = (result.candidates ?? []).filter((candidate) => candidate.finalCheck?.passed);
  const plannerInfo = result.plan?.planner ?? null;
  const workerVariantLines = formatWorkerVariantLines(result, currentScoring);
  const selectedDuration = selectorMetrics?.selectedDurationMs ?? (selectedCandidate?.selectedAttemptId == null ? null
    : selectedCandidate.attempts?.find((attempt) => attempt.attemptId === selectedCandidate.selectedAttemptId)?.durationMs);

  return [
    "COMMAND:",
    result.command || "(none)",
    "",
    "EXPLANATION:",
    result.explanation || "(none)",
    "",
    "CHECK:",
    `status: ${status}`,
    `iterations: ${result.finalCheck?.iterations ?? 0}`,
    `engine: ${result.finalCheck?.engine ?? "(unknown)"}`,
    `workers: ${result.plan?.workerTasks?.length ?? 0}`,
    `stop-reason: ${result.stopReason ?? "(none)"}`,
    `selector: ${result.selector?.name ?? "(none)"}`,
    `selected-candidate: ${result.selector?.selectedCandidateId ?? "(none)"}`,
    `${currentScoring ? "selected-judge-score" : "selected-score"}: ${selectedScore?.value ?? 0}`,
    `${currentScoring ? "judge-breakdown" : "score-breakdown"}: ${formatJudgeBreakdown(selectedScore)}`,
    `selected-shellgei-score: ${currentScoring ? formatScoreNumber(selectedShellgeiScore?.value) : selectedShellgeiScore?.value ?? 0}`,
    `shellgei-score-version: ${scoringVersion ?? "legacy"}`,
    ...(currentScoring ? [`performance-ms: ${Number.isFinite(selectedDuration) && selectedDuration >= 0 ? selectedDuration : "(unmeasured)"} (runner elapsed time, including startup; reference only)`] : []),
    `shellgei-breakdown: ${formatShellgeiBreakdown(selectedShellgeiScore, currentScoring)}`,
    `shellgei-notes: ${(selectedShellgeiScore?.notes ?? []).join(", ") || "(none)"}`,
    `shellgei-penalties: ${(selectedShellgeiScore?.penalties ?? []).join(", ") || "(none)"}`,
    `selector-reason: ${result.selector?.reason ?? "(none)"}`,
    formatSelectorMetrics(selectorMetrics, currentScoring),
    `planner-provider: ${plannerInfo?.provider ?? "(none)"}`,
    `planner-attempted-provider: ${plannerInfo?.attemptedProvider ?? "(none)"}`,
    `planner-fallback-reason: ${plannerInfo?.fallbackReason ?? "(none)"}`,
    `passing-candidates: ${passingCandidates.length}`,
    "",
    "WORKER VARIANTS:",
    ...workerVariantLines,
    "",
    "RUNNER:",
    `name: ${result.runner?.name ?? "(unknown)"}`,
    `sandbox: ${JSON.stringify(result.runner?.sandboxPolicy ?? null)}`,
    "",
    "LOG:",
    result.logPath ?? "(none)"
  ].join("\n");
}
