const strategyCatalog = [
  {
    strategy: "default",
    name: "balanced-search",
    focus: "Start with the most direct safe one-liner and keep the command shape simple.",
    retryHint: "Keep the command close to the previous attempt and adjust only the failing part."
  },
  {
    strategy: "awk-first",
    name: "awk-centric",
    focus: "Prefer awk for column-oriented or record-oriented transformations.",
    retryHint: "Retry by refining field separators, filters, or print formatting before changing tools."
  },
  {
    strategy: "text-filter",
    name: "filter-pipeline",
    focus: "Prefer grep, sed, tr, and shell pipelines for text filtering and selection.",
    retryHint: "Retry with a narrower pipeline when the first attempt is too broad."
  },
  {
    strategy: "normalization",
    name: "normalization",
    focus: "Prefer sorting, deduping, trimming, and canonicalizing output before more complex logic.",
    retryHint: "Retry by normalizing the data shape first when outputs differ only in presentation."
  }
];

function buildStrategyProfile(index) {
  const entry = strategyCatalog[index % strategyCatalog.length];
  return {
    name: entry.name,
    focus: entry.focus,
    retryHint: entry.retryHint
  };
}

export function createExecutionPlan(session) {
  const workerCount = Math.max(1, session.parallelism ?? 1);

  return {
    mode: session.mode,
    parallelism: workerCount,
    workerTasks: Array.from({ length: workerCount }, (_, index) => ({
      workerId: `worker-${index + 1}`,
      strategy: strategyCatalog[index % strategyCatalog.length].strategy,
      strategyProfile: buildStrategyProfile(index),
      maxAttempts: session.maxIterations
    }))
  };
}
