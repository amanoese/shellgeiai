function normalizeOutput(output) {
  return typeof output === "string" ? output.trim() : "";
}

const scoreComparisonOrder = [
  { key: "shellgeiScore", label: "shellgei score", higherIsBetter: true, unit: "" },
  { key: "judgeScore", label: "judge score", higherIsBetter: true, unit: "" },
  { key: "stdoutConsistency", label: "stdout consistency", higherIsBetter: true, unit: "" },
  { key: "outputConsensus", label: "output consensus", higherIsBetter: true, unit: "" },
  { key: "totalDurationMs", label: "total duration", higherIsBetter: false, unit: "ms" },
  { key: "iterationCount", label: "iteration count", higherIsBetter: false, unit: "" },
  { key: "commandLength", label: "command length", higherIsBetter: false, unit: " chars" },
  { key: "explanationLength", label: "explanation length", higherIsBetter: false, unit: " chars" }
];

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
  const shellgeiScore = candidate.shellgeiScore?.value ?? 0;
  const judgeScore = candidate.finalCheck?.score?.value ?? 0;
  const stdoutConsistency = stdoutConsistencyScore(candidate);
  const outputConsensus = outputConsensusScore(candidate, consensusByValue);

  return {
    totalScore: shellgeiScore + judgeScore + stdoutConsistency + outputConsensus,
    shellgeiScore,
    judgeScore,
    stdoutConsistency,
    outputConsensus,
    totalDurationMs,
    iterationCount: candidate.finalCheck?.iterations ?? attempts.length,
    commandLength,
    explanationLength
  };
}

function formatScoreValue(metric, value) {
  return metric.unit ? `${value}${metric.unit}` : `${value}`;
}

function describeScoreWin(winnerScore, loserScore) {
  for (const metric of scoreComparisonOrder) {
    if (winnerScore[metric.key] === loserScore[metric.key]) {
      continue;
    }

    const winnerValue = formatScoreValue(metric, winnerScore[metric.key]);
    const loserValue = formatScoreValue(metric, loserScore[metric.key]);
    const comparison = metric.higherIsBetter ? `${winnerValue} > ${loserValue}` : `${winnerValue} < ${loserValue}`;
    return `${metric.label} (${comparison})`;
  }

  return "all score dimensions were equal";
}

function describeBestScoreReason(selected, runnerUp, consensusByValue, hasPassingCandidates) {
  const prefix = hasPassingCandidates
    ? `Selected ${selected.candidateId} as the best passing candidate`
    : `No passing candidate was found; selected ${selected.candidateId} as the best fallback candidate`;

  if (!runnerUp) {
    return `${prefix}.`;
  }

  const selectedScore = candidateScore(selected, consensusByValue);
  const runnerUpScore = candidateScore(runnerUp, consensusByValue);
  return `${prefix} after comparing it with ${runnerUp.candidateId}; it won on ${describeScoreWin(
    selectedScore,
    runnerUpScore
  )}.`;
}

function compareCandidateScore(left, right, consensusByValue) {
  const leftScore = candidateScore(left, consensusByValue);
  const rightScore = candidateScore(right, consensusByValue);

  // ShellGei score is the primary signal; other measures are tie-breakers.
  if (leftScore.shellgeiScore !== rightScore.shellgeiScore) {
    return rightScore.shellgeiScore - leftScore.shellgeiScore;
  }

  if (leftScore.judgeScore !== rightScore.judgeScore) {
    return rightScore.judgeScore - leftScore.judgeScore;
  }

  if (leftScore.stdoutConsistency !== rightScore.stdoutConsistency) {
    return rightScore.stdoutConsistency - leftScore.stdoutConsistency;
  }

  if (leftScore.outputConsensus !== rightScore.outputConsensus) {
    return rightScore.outputConsensus - leftScore.outputConsensus;
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

export function selectSolveOutcome(candidates, selectorName = "first-pass-wins") {
  const passingCandidates = candidates.filter((candidate) => candidate.finalCheck.passed);
  const consensusByValue = outputConsensusByValue(candidates);
  let selected = null;
  let reason = "";
  let metrics = null;

  switch (selectorName) {
    case "best-score-wins":
      {
        const rankedPassingCandidates = passingCandidates.slice().sort((left, right) =>
          compareCandidateScore(left, right, consensusByValue)
        );
        const rankedCandidates = candidates.slice().sort((left, right) => compareCandidateScore(left, right, consensusByValue));
        selected = rankedPassingCandidates[0] ?? rankedCandidates[0] ?? null;
        const competitionPool = rankedPassingCandidates[0] ? rankedPassingCandidates : rankedCandidates;
        const runnerUp = competitionPool[1] ?? null;
        metrics = selected ? candidateScore(selected, consensusByValue) : null;
        reason = selected
          ? describeBestScoreReason(selected, runnerUp, consensusByValue, Boolean(rankedPassingCandidates[0]))
          : "No candidate was produced.";
        break;
      }
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
