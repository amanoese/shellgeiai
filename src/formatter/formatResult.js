export function formatResult(result) {
  const status = result.finalCheck.passed ? "passed" : "failed";
  const selectedScore = result.selector?.score;
  const selectorMetrics = result.selector?.metrics;
  const selectedCandidate = result.candidates?.find(
    (candidate) => candidate.candidateId === result.selector?.selectedCandidateId
  );
  const selectedShellgeiScore = selectedCandidate?.shellgeiScore;
  const passingCandidates = (result.candidates ?? []).filter((candidate) => candidate.finalCheck.passed);
  const passingLines = [
    "",
    "PASSING COMMANDS:",
    ...(passingCandidates.length
      ? passingCandidates.map((candidate) => {
          const candidateScore = candidate.shellgeiScore?.value ?? candidate.finalCheck.score?.value ?? 0;
          return `${candidate.candidateId} | score: ${candidateScore} | command: ${candidate.command}`;
        })
      : ["(none)"])
  ];

  return [
    "COMMAND:",
    result.command || "(none)",
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
    `selected-shellgei-score: ${selectedShellgeiScore?.value ?? 0}`,
    `shellgei-breakdown: shortness=${selectedShellgeiScore?.breakdown.shortness ?? 0}, simplicity=${selectedShellgeiScore?.breakdown.simplicity ?? 0}, speed=${selectedShellgeiScore?.breakdown.speed ?? 0}`,
    `selector-metrics: total=${selectorMetrics?.totalScore ?? 0}, shellgei=${selectorMetrics?.shellgeiScore ?? 0}, judge=${selectorMetrics?.judgeScore ?? 0}, stdout-consistency=${selectorMetrics?.stdoutConsistency ?? 0}, output-consensus=${selectorMetrics?.outputConsensus ?? 0}, duration-ms=${selectorMetrics?.totalDurationMs ?? 0}, iterations=${selectorMetrics?.iterationCount ?? 0}`,
    `selector-reason: ${result.selector?.reason ?? "No selector reason provided."}`,
    `runner: ${result.runner?.name ?? "local"}`,
    `sandbox-network: ${result.runner?.sandboxPolicy?.networkAccess ?? "off"}`,
    `sandbox-filesystem: ${result.runner?.sandboxPolicy?.filesystemScope ?? "workspace-write"}`,
    `reason: ${result.finalCheck.reason}`,
    `log: ${result.logPath}`,
    ...passingLines
  ].join("\n");
}
