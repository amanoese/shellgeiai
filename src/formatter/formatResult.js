export function formatResult(result) {
  const status = result.finalCheck.passed ? "passed" : "failed";
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
    `reason: ${result.finalCheck.reason}`,
    `log: ${result.logPath}`
  ].join("\n");
}
