import { analyzeShellCommand } from "./commandAnalyzer.js";

const DEFAULT_MODE = "simple";
const SCORE_MODES = new Set(["simple", "artistry", "robustness"]);
export const SHELLGEI_SCORE_VERSION = "length-artistry-v1";

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

function normalizeMode(mode) {
  return SCORE_MODES.has(mode) ? mode : DEFAULT_MODE;
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

export function countCommandCharacters(command) {
  let length = 0;
  for (const _character of command) length += 1;
  return length;
}

export function normalizeArtistry(ingenuityRaw, artistryRaw) {
  const mean = (ingenuityRaw + artistryRaw) / 2;
  // Fixed theoretical bounds of the existing rules, independent of candidates.
  return 100 * clamp((mean - 0.125) / 0.825);
}

export function calculateShellgeiScore(commandLength, artistry) {
  if (!Number.isSafeInteger(commandLength) || commandLength < 1) {
    throw new Error("Command length must be a positive safe integer.");
  }
  if (!Number.isFinite(artistry) || artistry < 0 || artistry > 100) {
    throw new Error("Artistry must be between 0 and 100.");
  }
  const effectiveLength = commandLength + 3.5 * (1 - artistry / 100);
  return { effectiveLength, value: 100 / (1 + effectiveLength / 100) };
}

/** Compare passing attempts/candidates without execution history or rounded scores. */
export function compareShellgeiCandidates(left, right) {
  const leftScore = left.shellgeiScore;
  const rightScore = right.shellgeiScore;
  const leftEffective = leftScore?.breakdown?.effectiveLength;
  const rightEffective = rightScore?.breakdown?.effectiveLength;
  if (Number.isFinite(leftEffective) && Number.isFinite(rightEffective)) {
    if (leftEffective !== rightEffective) return leftEffective < rightEffective ? -1 : 1;
  } else {
    // Compatibility for callers providing old, value-only score objects.
    const leftValue = leftScore?.value ?? -Infinity;
    const rightValue = rightScore?.value ?? -Infinity;
    if (leftValue !== rightValue) return leftValue > rightValue ? -1 : 1;
  }
  const leftLength = leftScore?.breakdown?.commandLength ??
    (typeof left.command === "string" ? countCommandCharacters(left.command) : Infinity);
  const rightLength = rightScore?.breakdown?.commandLength ??
    (typeof right.command === "string" ? countCommandCharacters(right.command) : Infinity);
  if (leftLength !== rightLength) return leftLength < rightLength ? -1 : 1;
  const leftCommand = left.command ?? "";
  const rightCommand = right.command ?? "";
  return leftCommand < rightCommand ? -1 : leftCommand > rightCommand ? 1 : 0;
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
  if (!candidate.finalCheck?.passed || typeof candidate.command !== "string" || !candidate.command.trim()) {
    return null;
  }

  const command = candidate.command;
  const mode = normalizeMode(options.mode ?? DEFAULT_MODE);
  const features = await analyzeShellCommand(command);
  const commandLength = countCommandCharacters(command);
  const artistry = normalizeArtistry(scoreIngenuityRaw(features), scoreArtistryRaw(features));
  const { value, effectiveLength } = calculateShellgeiScore(commandLength, artistry);
  const breakdown = {
    commandLength,
    artistry,
    effectiveLength,
    shellness: 100 * scoreShellnessRaw(features),
    readability: 100 * scoreReadabilityRaw(command, features)
  };

  return {
    value,
    version: SHELLGEI_SCORE_VERSION,
    mode,
    breakdown,
    notes: buildNotes(features),
    penalties: buildPenalties(command, features)
  };
}
