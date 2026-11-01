export function buildImprovementPrompt(context) {
  if (!context.bestCandidate) return "";
  return [
    "A previous command passed the checks. Improve its shell-gei score while preserving its behavior and output.",
    "Score = 100 / (1 + (L + 3.5 * (1 - A / 100)) / 100), where L counts Unicode code points including whitespace and A is combined ingenuity/artistry from 0 to 100. Higher is better.",
    "Reduce effectiveLength. Artistry can compensate for at most 3 extra characters; a command 4 or more characters longer cannot win on artistry alone.",
    "Shellness, readability, execution time, and retry history are reference information only. Notes and penalties explain patterns; they are not additional score deductions.",
    "Return a complete safe command.",
    `Best passing attempt: ${JSON.stringify(context.bestCandidate)}`
  ].join("\n");
}
