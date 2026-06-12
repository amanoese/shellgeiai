const DEFAULT_MODE = "standard";
const UNIX_TOOL_PATTERN = /\b(awk|sed|grep|sort|uniq|cut|tr|paste|xargs|find)\b/;

function commandTokenCount(command) {
  return command.trim().split(/\s+/).filter(Boolean).length;
}

function totalDurationMs(attempts) {
  return (attempts ?? []).reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
}

function hasUselessCat(command) {
  return /\bcat\s+\S+\s+\|\s+/.test(command);
}

function usesStandardUnixTools(command) {
  return UNIX_TOOL_PATTERN.test(command);
}

function scoreConciseness(command) {
  const lengthPenalty = Math.min(8, Math.floor((command.length || 0) / 24));
  const catPenalty = hasUselessCat(command) ? 2 : 0;
  return Math.max(0, 15 - lengthPenalty - catPenalty);
}

function scoreShellness(command) {
  const usesPipeline = command.includes("|");
  return Math.min(15, (usesPipeline ? 7 : 0) + (usesStandardUnixTools(command) ? 8 : 3));
}

function scoreIngenuity(command) {
  if (usesStandardUnixTools(command) && !command.includes(";")) {
    return 10;
  }
  return 4;
}

function scoreReadability(command) {
  const tokens = commandTokenCount(command);
  return Math.max(0, 15 - Math.max(0, tokens - 6) * 2);
}

function scoreRobustness(candidate, command) {
  const durationPenalty = Math.min(5, Math.floor(totalDurationMs(candidate.attempts) / 200));
  const stderrPenalty = candidate.finalCheck?.gate?.stderrAllowed === false ? 3 : 0;
  const toolBonus = usesStandardUnixTools(command) ? 2 : 0;
  return Math.max(0, Math.min(15, 10 + toolBonus - durationPenalty - stderrPenalty));
}

function scoreArtistry(command) {
  if (command.includes("|") && usesStandardUnixTools(command)) {
    return 8;
  }
  return usesStandardUnixTools(command) ? 5 : 2;
}

function buildNotes(command) {
  const notes = [];

  if (usesStandardUnixTools(command)) {
    notes.push("Uses standard Unix tools.");
  }
  if (!hasUselessCat(command) && usesStandardUnixTools(command)) {
    notes.push("Avoids redundant pipeline stages.");
  }

  return notes;
}

function buildPenalties(command) {
  return hasUselessCat(command) ? ["Avoid useless use of cat."] : [];
}

export function scoreShellgeiCandidate(candidate, options = {}) {
  if (!candidate.finalCheck?.passed) {
    return null;
  }

  const command = candidate.command ?? "";
  const mode = options.mode ?? DEFAULT_MODE;
  const breakdown = {
    conciseness: scoreConciseness(command),
    shellness: scoreShellness(command),
    ingenuity: scoreIngenuity(command),
    readability: scoreReadability(command),
    robustness: scoreRobustness(candidate, command),
    artistry: scoreArtistry(command)
  };

  return {
    value: Object.values(breakdown).reduce((sum, score) => sum + score, 0),
    mode,
    breakdown,
    notes: buildNotes(command),
    penalties: buildPenalties(command)
  };
}
