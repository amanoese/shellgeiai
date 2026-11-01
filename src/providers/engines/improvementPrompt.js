export function buildImprovementPrompt(context) {
  if (!context.bestCandidate) return "";
  return [
    "A previous command passed the checks. Improve its shell-gei score while preserving its behavior and output.",
    "Use the score breakdown, notes, and penalties to guide the improvement. Return a complete safe command.",
    `Best passing attempt: ${JSON.stringify(context.bestCandidate)}`
  ].join("\n");
}
