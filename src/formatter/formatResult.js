export function formatResult(result) {
  const status = result.finalCheck.passed ? "passed" : "failed";
  const selectedScore = result.selector?.score;
  const selectorMetrics = result.selector?.metrics;
  const candidateLines =
    result.candidates?.length > 1
      ? [
          "",
          "CANDIDATES:",
          ...result.candidates.map((candidate) => {
            const candidateStatus = candidate.finalCheck.passed ? "passed" : "failed";
            const candidateScore = candidate.finalCheck.score?.value ?? 0;
            return `${candidate.candidateId}: ${candidateStatus} | strategy: ${candidate.strategy ?? "default"} | iterations: ${candidate.finalCheck.iterations} | score: ${candidateScore} | reason: ${candidate.finalCheck.reason}`;
          })
        ]
      : [];

  return [
    "COMMAND:",
    result.command || "(none)",
    "",
    "OUTPUT:",
    result.output || "(empty)",
    "",
    "EXPLANATION:",
    result.explanation,
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
    `score-breakdown: correctness=${selectedScore?.breakdown.correctness ?? 0}, stdout=${selectedScore?.breakdown.stdoutQuality ?? 0}, stderr=${selectedScore?.breakdown.stderrQuality ?? 0}, expected=${selectedScore?.breakdown.expectedOutput ?? 0}`,
    `selector-metrics: total=${selectorMetrics?.totalScore ?? 0}, judge=${selectorMetrics?.judgeScore ?? 0}, stdout-consistency=${selectorMetrics?.stdoutConsistency ?? 0}, output-consensus=${selectorMetrics?.outputConsensus ?? 0}, duration-ms=${selectorMetrics?.totalDurationMs ?? 0}, iterations=${selectorMetrics?.iterationCount ?? 0}`,
    `selector-reason: ${result.selector?.reason ?? "No selector reason provided."}`,
    `runner: ${result.runner?.name ?? "local"}`,
    `sandbox-network: ${result.runner?.sandboxPolicy?.networkAccess ?? "off"}`,
    `sandbox-filesystem: ${result.runner?.sandboxPolicy?.filesystemScope ?? "workspace-write"}`,
    `reason: ${result.finalCheck.reason}`,
    `log: ${result.logPath}`,
    ...candidateLines
  ].join("\n");
}
