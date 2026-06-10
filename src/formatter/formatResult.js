export function formatResult(result) {
  const status = result.finalCheck.passed ? "passed" : "failed";
  const candidateLines =
    result.candidates?.length > 1
      ? [
          "",
          "CANDIDATES:",
          ...result.candidates.map((candidate) => {
            const candidateStatus = candidate.finalCheck.passed ? "passed" : "failed";
            return `${candidate.candidateId}: ${candidateStatus} | strategy: ${candidate.strategy ?? "default"} | iterations: ${candidate.finalCheck.iterations} | reason: ${candidate.finalCheck.reason}`;
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
    `selector-reason: ${result.selector?.reason ?? "No selector reason provided."}`,
    `runner: ${result.runner?.name ?? "local"}`,
    `sandbox-network: ${result.runner?.sandboxPolicy?.networkAccess ?? "off"}`,
    `sandbox-filesystem: ${result.runner?.sandboxPolicy?.filesystemScope ?? "workspace-write"}`,
    `reason: ${result.finalCheck.reason}`,
    `log: ${result.logPath}`,
    ...candidateLines
  ].join("\n");
}
