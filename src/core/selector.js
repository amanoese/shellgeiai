function candidateScore(candidate) {
  const attempts = candidate.attempts ?? [];
  const totalDurationMs = attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
  const commandLength = candidate.command?.length ?? Number.MAX_SAFE_INTEGER;

  return {
    totalDurationMs,
    iterationCount: candidate.finalCheck?.iterations ?? attempts.length,
    commandLength
  };
}

function compareCandidateScore(left, right) {
  const leftScore = candidateScore(left);
  const rightScore = candidateScore(right);

  if (leftScore.totalDurationMs !== rightScore.totalDurationMs) {
    return leftScore.totalDurationMs - rightScore.totalDurationMs;
  }

  if (leftScore.iterationCount !== rightScore.iterationCount) {
    return leftScore.iterationCount - rightScore.iterationCount;
  }

  return leftScore.commandLength - rightScore.commandLength;
}

export function selectSolveOutcome(candidates, selectorName = "first-pass-wins") {
  const passingCandidates = candidates.filter((candidate) => candidate.finalCheck.passed);
  let selected = null;
  let reason = "";

  switch (selectorName) {
    case "best-score-wins":
      selected =
        passingCandidates.slice().sort(compareCandidateScore)[0] ??
        candidates.slice().sort(compareCandidateScore)[0] ??
        null;
      reason = selected?.finalCheck.passed
        ? "Selected the passing candidate with the best score."
        : "No passing candidate was found; selected the candidate with the best fallback score.";
      break;
    case "first-pass-wins":
    default:
      selected = passingCandidates[0] ?? candidates.at(-1) ?? null;
      reason = selected?.finalCheck.passed
        ? "Selected the first candidate that passed final checks."
        : "No passing candidate was found; selected the latest candidate.";
      break;
  }

  return {
    selectedCandidate: selected,
    selector: selectorName,
    reason
  };
}
