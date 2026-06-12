export const strategyCatalog = [
  {
    strategy: "default",
    name: "balanced-search",
    focus: "Start with direct safe one-liner.",
    retryHint: "Remove redundant stages before changing whole approach.",
    rubricFocus: ["conciseness", "shellness", "robustness"]
  },
  {
    strategy: "awk-first",
    name: "awk-centric",
    focus: "Prefer awk for record-wise transforms.",
    retryHint: "Remove redundant stages before switching tools.",
    rubricFocus: ["shellness", "readability", "ingenuity"]
  },
  {
    strategy: "text-filter",
    name: "filter-pipeline",
    focus: "Prefer grep, sed, tr, and shell pipelines for text filtering.",
    retryHint: "Remove redundant stages before widening the pipeline.",
    rubricFocus: ["conciseness", "shellness", "readability"]
  },
  {
    strategy: "normalization",
    name: "normalization",
    focus: "Normalize output shape before adding more logic.",
    retryHint: "Remove redundant stages before adding a second pass.",
    rubricFocus: ["robustness", "readability", "conciseness"]
  }
];

export function buildStrategyProfile(index) {
  const entry = strategyCatalog[index % strategyCatalog.length];

  return {
    name: entry.name,
    focus: entry.focus,
    retryHint: entry.retryHint,
    rubricFocus: entry.rubricFocus
  };
}

export function getStrategyName(index) {
  return strategyCatalog[index % strategyCatalog.length].strategy;
}
