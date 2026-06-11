function commandTokenCount(command) {
  return command.trim().split(/\s+/).filter(Boolean).length;
}

function totalDurationMs(attempts) {
  return (attempts ?? []).reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
}

/**
 * @typedef {Object} ShellGeiScore
 * @property {number} value
 * @property {{shortness: number, simplicity: number, speed: number}} breakdown
 */

export function scoreShellgeiCandidate(candidate) {
  if (!candidate.finalCheck?.passed) {
    return null;
  }

  const command = candidate.command ?? "";
  const length = command.length;
  const tokens = commandTokenCount(command);
  const durationMs = totalDurationMs(candidate.attempts);

  const breakdown = {
    shortness: Math.max(0, 50 - Math.min(50, length)),
    simplicity: Math.max(0, 30 - Math.max(0, (tokens - 1) * 3)),
    speed: Math.max(0, 20 - Math.min(20, Math.floor(durationMs / 25)))
  };

  return {
    value: Object.values(breakdown).reduce((sum, score) => sum + score, 0),
    breakdown
  };
}
