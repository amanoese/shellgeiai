import { analyzeShellCommand } from "./commandAnalyzer.js";

const DEFAULT_MODE = "simple";

const MODE_WEIGHTS = {
  simple: {
    conciseness: 25,
    shellness: 20,
    ingenuity: 15,
    readability: 10,
    robustness: 20,
    artistry: 10
  },
  artistry: {
    conciseness: 15,
    shellness: 20,
    ingenuity: 25,
    readability: 10,
    robustness: 10,
    artistry: 20
  },
  robustness: {
    conciseness: 10,
    shellness: 15,
    ingenuity: 10,
    readability: 20,
    robustness: 35,
    artistry: 10
  }
};

const UNIX_TOOLS = new Set([
  "awk",
  "sed",
  "grep",
  "sort",
  "uniq",
  "cut",
  "tr",
  "paste",
  "xargs",
  "find",
  "jq",
  "comm",
  "join",
  "head",
  "tail",
  "wc"
]);
const TRANSFORM_TOOLS = new Set([
  "awk",
  "sed",
  "perl",
  "node",
  "python",
  "python3",
  "ruby",
  "jq",
  "sort",
  "uniq",
  "cut",
  "tr",
  "paste"
]);

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function commandTokenCount(command) {
  return command.trim().split(/\s+/).filter(Boolean).length;
}

function totalDurationMs(attempts) {
  return (attempts ?? []).reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
}

function normalizeMode(mode) {
  return MODE_WEIGHTS[mode] ? mode : DEFAULT_MODE;
}

function hasUselessCat(command) {
  return /\bcat\s+\S+\s+\|\s+/.test(command);
}

function countUnixTools(features) {
  return features.commandNames.filter((name) => UNIX_TOOLS.has(name)).length;
}

function countTransformTools(features) {
  return features.commandNames.filter((name) => TRANSFORM_TOOLS.has(name)).length;
}

function usesLanguageAsShellTool(features) {
  return features.languageOneLiners.some((oneLiner) => oneLiner.inPipeline);
}

function scoreConcisenessRaw(command, features) {
  const lengthPenalty = Math.min(0.3, command.length / 260);
  const tokenPenalty = Math.min(0.25, Math.max(0, commandTokenCount(command) - 8) * 0.025);
  const commandPenalty = Math.min(0.2, Math.max(0, features.simpleCommandCount - 3) * 0.06);
  const catPenalty = hasUselessCat(command) ? 0.2 : 0;
  return clamp(1 - lengthPenalty - tokenPenalty - commandPenalty - catPenalty);
}

function scoreShellnessRaw(features) {
  let score = 0.2;
  if (features.pipelineCount > 0) {
    score += 0.25;
  }
  if (countUnixTools(features) > 0) {
    score += 0.25;
  }
  if (usesLanguageAsShellTool(features)) {
    score += 0.25;
  } else if (features.languageOneLiners.length > 0) {
    score += 0.08;
  }
  if (features.hasRedirection || features.hasCommandSubstitution) {
    score += 0.05;
  }
  return clamp(score);
}

function scoreIngenuityRaw(features) {
  let score = 0.15;
  if (countTransformTools(features) > 0) {
    score += 0.2;
  }
  if (features.pipelineCount > 0) {
    score += 0.15;
  }
  if (features.commandNames.some((name) => ["sort", "uniq", "comm", "join", "paste"].includes(name))) {
    score += 0.15;
  }
  if (usesLanguageAsShellTool(features)) {
    score += 0.2;
  }
  if (features.commandNames.includes("node") && features.languageOneLiners.length > 0) {
    score += 0.1;
  }
  return clamp(score);
}

function scoreReadabilityRaw(command, features) {
  const tokens = commandTokenCount(command);
  const tokenPenalty = Math.min(0.3, Math.max(0, tokens - 10) * 0.03);
  const commandPenalty = Math.min(0.2, Math.max(0, features.simpleCommandCount - 3) * 0.05);
  const substitutionPenalty = features.hasCommandSubstitution ? 0.08 : 0;
  const andOrPenalty = features.hasAndOrList ? 0.06 : 0;
  return clamp(1 - tokenPenalty - commandPenalty - substitutionPenalty - andOrPenalty);
}

function scoreRobustnessRaw(candidate, features) {
  const durationPenalty = Math.min(0.25, totalDurationMs(candidate.attempts) / 2500);
  const stderrPenalty = candidate.finalCheck?.gate?.stderrAllowed === false ? 0.2 : 0;
  const dangerousPenalty = features.dangerousCommands.length > 0 ? 0.35 : 0;
  const substitutionPenalty = features.hasCommandSubstitution ? 0.08 : 0;
  const xargsPenalty = features.commandNames.includes("xargs") ? 0.08 : 0;
  const toolBonus = countUnixTools(features) > 0 || usesLanguageAsShellTool(features) ? 0.08 : 0;
  return clamp(0.8 + toolBonus - durationPenalty - stderrPenalty - dangerousPenalty - substitutionPenalty - xargsPenalty);
}

function scoreArtistryRaw(features) {
  let score = 0.1;
  if (features.pipelineCount > 0) {
    score += 0.2;
  }
  if (countUnixTools(features) > 0) {
    score += 0.15;
  }
  if (usesLanguageAsShellTool(features)) {
    score += 0.2;
  }
  if (features.commandNames.includes("node") && features.languageOneLiners.length > 0) {
    score += 0.15;
  }
  if (scoreIngenuityRaw(features) >= 0.65) {
    score += 0.15;
  }
  return clamp(score);
}

function weightedBreakdown(rawScores, weights) {
  return Object.fromEntries(
    Object.entries(weights).map(([axis, weight]) => [
      axis,
      Math.round(rawScores[axis] * weight)
    ])
  );
}

function buildNotes(features) {
  const notes = [];
  if (features.parsed) {
    notes.push("Analyzed command structure with Bash AST.");
  }
  if (features.pipelineCount > 0) {
    notes.push("Uses a pipeline to connect small tools.");
  }
  if (countUnixTools(features) > 0) {
    notes.push("Uses standard Unix tools.");
  }
  if (usesLanguageAsShellTool(features)) {
    notes.push("Uses a language one-liner as a stdin/stdout shell tool.");
  }
  if (notes.length === 0) {
    notes.push("Solves the task without much shell composition.");
  }
  return notes;
}

function buildPenalties(command, features) {
  const penalties = [];
  if (hasUselessCat(command)) {
    penalties.push("Avoid useless use of cat.");
  }
  if (features.dangerousCommands.length > 0) {
    penalties.push("Contains risky command patterns.");
  }
  if (features.languageOneLiners.length > 0 && !usesLanguageAsShellTool(features)) {
    penalties.push("Language one-liner is not integrated with stdin/stdout flow.");
  }
  if (commandTokenCount(command) > 18) {
    penalties.push("Command is relatively dense for a shellgei answer.");
  }
  return penalties;
}

export async function scoreShellgeiCandidate(candidate, options = {}) {
  if (!candidate.finalCheck?.passed) {
    return null;
  }

  const command = candidate.command ?? "";
  const mode = normalizeMode(options.mode ?? DEFAULT_MODE);
  const features = await analyzeShellCommand(command);
  const rawScores = {
    conciseness: scoreConcisenessRaw(command, features),
    shellness: scoreShellnessRaw(features),
    ingenuity: scoreIngenuityRaw(features),
    readability: scoreReadabilityRaw(command, features),
    robustness: scoreRobustnessRaw(candidate, features),
    artistry: scoreArtistryRaw(features)
  };
  const breakdown = weightedBreakdown(rawScores, MODE_WEIGHTS[mode]);
  const value = Object.values(breakdown).reduce((sum, score) => sum + score, 0);

  return {
    value,
    mode,
    breakdown,
    notes: buildNotes(features),
    penalties: buildPenalties(command, features)
  };
}
