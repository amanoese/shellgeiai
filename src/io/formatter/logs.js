function formatMaybe(value, fallback = "(none)") {
  return value == null || value === "" ? fallback : String(value);
}

export function formatLogSummary(summary) {
  const status =
    summary.passed == null ? "unknown" : summary.passed ? "passed" : "failed";
  const parts = [
    summary.logId,
    summary.mode,
    status,
    `selected=${formatMaybe(summary.selectedCandidateId)}`,
    `problem=${formatMaybe(summary.problem)}`,
    `command=${formatMaybe(summary.command)}`
  ];

  return parts.join(" | ");
}

export function formatLogSummaries(summaries, heading) {
  const lines = [heading];
  if (summaries.length === 0) {
    lines.push("(no saved logs)");
    return lines.join("\n");
  }

  for (const summary of summaries) {
    lines.push(formatLogSummary(summary));
  }

  return lines.join("\n");
}

export function formatPruneResult(result) {
  const lines = [
    "PRUNE:",
    `cutoff-at: ${result.cutoffAt}`,
    `deleted-count: ${result.deletedCount}`,
    `kept-count: ${result.keptCount}`
  ];

  if (result.deleted.length > 0) {
    lines.push("", "DELETED:");
    for (const summary of result.deleted) {
      lines.push(formatLogSummary(summary));
    }
  }

  if (result.kept.length > 0) {
    lines.push("", "KEPT:");
    for (const summary of result.kept) {
      lines.push(formatLogSummary(summary));
    }
  }

  return lines.join("\n");
}
