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

function candidateMetrics(candidate, consensusByValue) {
  const attempts = candidate.attempts ?? [];
  const totalDurationMs = attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
  const shellgeiScore = candidate.shellgeiScore?.value ?? 0;
  const judgeScore = candidate.finalCheck?.score?.value ?? 0;
  const stdoutConsistency = stdoutConsistencyScore(candidate);
  const outputConsensus = outputConsensusScore(candidate, consensusByValue);

  return {
    totalScore: shellgeiScore + judgeScore + stdoutConsistency + outputConsensus,
    shellgeiScore,
    rubricBreakdown: candidate.shellgeiScore?.breakdown ?? null,
    judgeScore,
    stdoutConsistency,
    outputConsensus,
    totalDurationMs,
    iterationCount: candidate.finalCheck?.iterations ?? attempts.length,
    commandLength: candidate.command?.length ?? Number.MAX_SAFE_INTEGER,
    explanationLength: candidate.explanation?.length ?? Number.MAX_SAFE_INTEGER
  };
}

function compareCandidateScore(left, right, consensusByValue) {
  const leftScore = candidateMetrics(left, consensusByValue);
  const rightScore = candidateMetrics(right, consensusByValue);

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

function describeBestScoreReason(selected, runnerUp, consensusByValue, usedPassingPool) {
  if (!selected) {
    return "No candidate was produced.";
  }

  if (!runnerUp) {
    return usedPassingPool
      ? `Selected ${selected.candidateId} as best passing candidate.`
      : `No passing candidate was found; selected ${selected.candidateId} as best fallback candidate.`;
  }

  const selectedMetrics = candidateMetrics(selected, consensusByValue);
  const runnerUpMetrics = candidateMetrics(runnerUp, consensusByValue);
  let detail = "tie-breakers";

  if (selectedMetrics.shellgeiScore !== runnerUpMetrics.shellgeiScore) {
    detail = `shellgei score (${selectedMetrics.shellgeiScore} > ${runnerUpMetrics.shellgeiScore})`;
  } else if (selectedMetrics.judgeScore !== runnerUpMetrics.judgeScore) {
    detail = `judge score (${selectedMetrics.judgeScore} > ${runnerUpMetrics.judgeScore})`;
  } else if (selectedMetrics.stdoutConsistency !== runnerUpMetrics.stdoutConsistency) {
    detail = `stdout consistency (${selectedMetrics.stdoutConsistency} > ${runnerUpMetrics.stdoutConsistency})`;
  } else if (selectedMetrics.outputConsensus !== runnerUpMetrics.outputConsensus) {
    detail = `output consensus (${selectedMetrics.outputConsensus} > ${runnerUpMetrics.outputConsensus})`;
  }

  if (usedPassingPool) {
    return `Selected ${selected.candidateId} as best passing candidate; it won on ${detail}.`;
  }
  return `No passing candidate was found; selected ${selected.candidateId} as best fallback candidate; it won on ${detail}.`;
}

export function selectSolveOutcome(candidates, selectorName = "first-pass-wins") {
  const passingCandidates = candidates.filter((candidate) => candidate.finalCheck?.passed);
  const consensusByValue = outputConsensusByValue(candidates);

  let selectedCandidate = null;
  let reason = "";
  let metrics = null;

  switch (selectorName) {
    case "best-score-wins": {
      const rankedPassingCandidates = passingCandidates
        .slice()
        .sort((left, right) => compareCandidateScore(left, right, consensusByValue));
      const rankedCandidates = candidates
        .slice()
        .sort((left, right) => compareCandidateScore(left, right, consensusByValue));
      const competitionPool = rankedPassingCandidates[0] ? rankedPassingCandidates : rankedCandidates;
      selectedCandidate = competitionPool[0] ?? null;
      metrics = selectedCandidate ? candidateMetrics(selectedCandidate, consensusByValue) : null;
      reason = describeBestScoreReason(
        selectedCandidate,
        competitionPool[1] ?? null,
        consensusByValue,
        Boolean(rankedPassingCandidates[0])
      );
      break;
    }

    case "first-pass-wins":
    default:
      selectedCandidate = passingCandidates[0] ?? candidates.at(-1) ?? null;
      metrics = selectedCandidate ? candidateMetrics(selectedCandidate, consensusByValue) : null;
      reason = selectedCandidate?.finalCheck?.passed
        ? "Selected first candidate passed final checks."
        : "No passing candidate was found; selected latest candidate.";
      break;
  }

  return {
    selectedCandidate,
    selector: selectorName,
    reason,
    score: selectedCandidate?.finalCheck?.score ?? null,
    metrics
  };
}
