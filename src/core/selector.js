function normalizeOutput(output) {
  return typeof output === "string" ? output.trim() : "";
}

function outputConsensusByValue(candidates) {
  const counts = new Map();

  for (const candidate of candidates) {
    if (!candidate.finalCheck?.passed) {
      continue;
    }

    const output = normalizeOutput(candidate.output);
    if (!output) {
      continue;
    }

    counts.set(output, (counts.get(output) ?? 0) + 1);
  }

  return counts;
}

function stdoutConsistencyScore(candidate) {
  const uniqueOutputs = new Set(
    (candidate.attempts ?? [])
      .map((attempt) => normalizeOutput(attempt.stdout))
      .filter(Boolean)
  );

  if (uniqueOutputs.size === 0) {
    return 0;
  }

  if (uniqueOutputs.size === 1) {
    return 10;
  }

  return Math.max(0, 10 - (uniqueOutputs.size - 1) * 5);
}

function outputConsensusScore(candidate, consensusByValue) {
  if (!candidate.finalCheck?.passed) {
    return 0;
  }

  const output = normalizeOutput(candidate.output);
  if (!output) {
    return 0;
  }

  const matches = consensusByValue.get(output) ?? 0;
  if (matches <= 1) {
    return 0;
  }

  return Math.min(10, (matches - 1) * 5);
}

function candidateScore(candidate, consensusByValue) {
  const attempts = candidate.attempts ?? [];
  const totalDurationMs = attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
  const commandLength = candidate.command?.length ?? Number.MAX_SAFE_INTEGER;
  const explanationLength = candidate.explanation?.length ?? Number.MAX_SAFE_INTEGER;
  const judgeScore = candidate.finalCheck?.score?.value ?? 0;
  const stdoutConsistency = stdoutConsistencyScore(candidate);
  const outputConsensus = outputConsensusScore(candidate, consensusByValue);

  return {
    totalScore: judgeScore + stdoutConsistency + outputConsensus,
    judgeScore,
    stdoutConsistency,
    outputConsensus,
    totalDurationMs,
    iterationCount: candidate.finalCheck?.iterations ?? attempts.length,
    commandLength,
    explanationLength
  };
}

function compareCandidateScore(left, right, consensusByValue) {
  const leftScore = candidateScore(left, consensusByValue);
  const rightScore = candidateScore(right, consensusByValue);

  if (leftScore.totalScore !== rightScore.totalScore) {
    return rightScore.totalScore - leftScore.totalScore;
  }

  if (leftScore.judgeScore !== rightScore.judgeScore) {
    return rightScore.judgeScore - leftScore.judgeScore;
  }

  if (leftScore.totalDurationMs !== rightScore.totalDurationMs) {
    return leftScore.totalDurationMs - rightScore.totalDurationMs;
  }

  if (leftScore.iterationCount !== rightScore.iterationCount) {
    return leftScore.iterationCount - rightScore.iterationCount;
  }

  if (leftScore.commandLength !== rightScore.commandLength) {
    return leftScore.commandLength - rightScore.commandLength;
  }

  return leftScore.explanationLength - rightScore.explanationLength;
}

function describeSelectedScore(candidate, consensusByValue) {
  const score = candidateScore(candidate, consensusByValue);
  const breakdown = candidate.finalCheck?.score?.breakdown;

  if (!breakdown) {
    return `total=${score.totalScore}, judge=${score.judgeScore}, stdout-consistency=${score.stdoutConsistency}, output-consensus=${score.outputConsensus}`;
  }

  return `total=${score.totalScore}, judge=${score.judgeScore}, stdout-consistency=${score.stdoutConsistency}, output-consensus=${score.outputConsensus}, judge-breakdown=(correctness=${breakdown.correctness}, stdout=${breakdown.stdoutQuality}, stderr=${breakdown.stderrQuality}, expected=${breakdown.expectedOutput})`;
}

export function selectSolveOutcome(candidates, selectorName = "first-pass-wins") {
  const passingCandidates = candidates.filter((candidate) => candidate.finalCheck.passed);
  const consensusByValue = outputConsensusByValue(candidates);
  let selected = null;
  let reason = "";
  let metrics = null;

  switch (selectorName) {
    case "best-score-wins":
      selected =
        passingCandidates.slice().sort((left, right) => compareCandidateScore(left, right, consensusByValue))[0] ??
        candidates.slice().sort((left, right) => compareCandidateScore(left, right, consensusByValue))[0] ??
        null;
      metrics = selected ? candidateScore(selected, consensusByValue) : null;
      reason = selected?.finalCheck.passed
        ? `Selected the passing candidate with the best score; ${describeSelectedScore(selected, consensusByValue)}.`
        : `No passing candidate was found; selected the candidate with the best fallback score; ${describeSelectedScore(selected, consensusByValue)}.`;
      break;
    case "first-pass-wins":
    default:
      selected = passingCandidates[0] ?? candidates.at(-1) ?? null;
      metrics = selected ? candidateScore(selected, consensusByValue) : null;
      reason = selected?.finalCheck.passed
        ? "Selected the first candidate that passed final checks."
        : "No passing candidate was found; selected the latest candidate.";
      break;
  }

  return {
    selectedCandidate: selected,
    selector: selectorName,
    reason,
    score: selected?.finalCheck?.score ?? null,
    metrics
  };
}
