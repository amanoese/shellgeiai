import type { WorkerCandidate, SolveAttempt, ShellgeiScore, ShellgeiScoreMode, SelectorName } from "../types.js";
import type { ShellCommandFeatures } from "../shell/analyzer.js";

import { analyzeShellCommand } from "../shell/analyzer.js";

function normalizeOutput(output: unknown) {
    return typeof output === "string" ? output.trim() : "";
}

function outputConsensusByValue(candidates: WorkerCandidate[]) {
    const counts = new Map<string, number>();
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

function stdoutConsistencyScore(candidate: WorkerCandidate) {
    const uniqueOutputs = new Set((candidate.attempts ?? [])
        .map((attempt) => normalizeOutput(attempt.stdout))
        .filter(Boolean));
    if (uniqueOutputs.size === 0) {
        return 0;
    }
    if (uniqueOutputs.size === 1) {
        return 10;
    }
    return Math.max(0, 10 - (uniqueOutputs.size - 1) * 5);
}

function outputConsensusScore(candidate: WorkerCandidate, consensusByValue: Map<string, number>) {
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

function candidateMetrics(candidate: WorkerCandidate, consensusByValue: Map<string, number>) {
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

function compareCandidateScore(left: WorkerCandidate, right: WorkerCandidate, consensusByValue: Map<string, number>) {
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

function describeBestScoreReason(selected: WorkerCandidate | null, runnerUp: WorkerCandidate | null, consensusByValue: Map<string, number>, usedPassingPool: boolean) {
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
    }
    else if (selectedMetrics.judgeScore !== runnerUpMetrics.judgeScore) {
        detail = `judge score (${selectedMetrics.judgeScore} > ${runnerUpMetrics.judgeScore})`;
    }
    else if (selectedMetrics.stdoutConsistency !== runnerUpMetrics.stdoutConsistency) {
        detail = `stdout consistency (${selectedMetrics.stdoutConsistency} > ${runnerUpMetrics.stdoutConsistency})`;
    }
    else if (selectedMetrics.outputConsensus !== runnerUpMetrics.outputConsensus) {
        detail = `output consensus (${selectedMetrics.outputConsensus} > ${runnerUpMetrics.outputConsensus})`;
    }
    if (usedPassingPool) {
        return `Selected ${selected.candidateId} as best passing candidate; it won on ${detail}.`;
    }
    return `No passing candidate was found; selected ${selected.candidateId} as best fallback candidate; it won on ${detail}.`;
}

export function selectSolveOutcome(candidates: WorkerCandidate[], selectorName: SelectorName = "first-pass-wins") {
    const passingCandidates = candidates.filter((candidate) => candidate.finalCheck?.passed);
    const consensusByValue = outputConsensusByValue(candidates);
    let selectedCandidate: WorkerCandidate | null = null;
    let reason = "";
    let metrics: ReturnType<typeof candidateMetrics> | null = null;
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
            reason = describeBestScoreReason(selectedCandidate, competitionPool[1] ?? null, consensusByValue, Boolean(rankedPassingCandidates[0]));
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

function clamp(value: number, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}

function commandTokenCount(command: string) {
    return command.trim().split(/\s+/).filter(Boolean).length;
}

function totalDurationMs(attempts: SolveAttempt[] | undefined) {
    return (attempts ?? []).reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
}

function normalizeMode(mode: string): ShellgeiScoreMode {
    return mode === "simple" || mode === "artistry" || mode === "robustness" ? mode : DEFAULT_MODE;
}

function hasUselessCat(command: string) {
    return /\bcat\s+\S+\s+\|\s+/.test(command);
}

function countUnixTools(features: ShellCommandFeatures) {
    return features.commandNames.filter((name) => UNIX_TOOLS.has(name)).length;
}

function countTransformTools(features: ShellCommandFeatures) {
    return features.commandNames.filter((name) => TRANSFORM_TOOLS.has(name)).length;
}

function usesLanguageAsShellTool(features: ShellCommandFeatures) {
    return features.languageOneLiners.some((oneLiner) => oneLiner.inPipeline);
}

function scoreConcisenessRaw(command: string) {
    const lengthPenalty = Math.min(0.3, command.length / 260);
    const catPenalty = hasUselessCat(command) ? 0.2 : 0;
    return clamp(1 - lengthPenalty - catPenalty);
}

function scoreShellnessRaw(features: ShellCommandFeatures) {
    let score = 0.2;
    if (features.pipelineCount > 0) {
        score += 0.25;
    }
    if (countUnixTools(features) > 0) {
        score += 0.25;
    }
    if (usesLanguageAsShellTool(features)) {
        score += 0.25;
    }
    else if (features.languageOneLiners.length > 0) {
        score += 0.08;
    }
    if (features.hasRedirection || features.hasCommandSubstitution) {
        score += 0.05;
    }
    return clamp(score);
}

function scoreIngenuityRaw(features: ShellCommandFeatures) {
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

function scoreReadabilityRaw(command: string, features: ShellCommandFeatures) {
    const tokens = commandTokenCount(command);
    const tokenPenalty = Math.min(0.3, Math.max(0, tokens - 10) * 0.03);
    const commandPenalty = Math.min(0.2, Math.max(0, features.simpleCommandCount - 3) * 0.05);
    const substitutionPenalty = features.hasCommandSubstitution ? 0.08 : 0;
    const andOrPenalty = features.hasAndOrList ? 0.06 : 0;
    return clamp(1 - tokenPenalty - commandPenalty - substitutionPenalty - andOrPenalty);
}

function scoreRobustnessRaw(candidate: WorkerCandidate, features: ShellCommandFeatures) {
    const durationPenalty = Math.min(0.25, totalDurationMs(candidate.attempts) / 2500);
    const stderrPenalty = candidate.finalCheck?.gate?.stderrAllowed === false ? 0.2 : 0;
    const dangerousPenalty = features.dangerousCommands.length > 0 ? 0.35 : 0;
    const substitutionPenalty = features.hasCommandSubstitution ? 0.08 : 0;
    const xargsPenalty = features.commandNames.includes("xargs") ? 0.08 : 0;
    const toolBonus = countUnixTools(features) > 0 || usesLanguageAsShellTool(features) ? 0.08 : 0;
    return clamp(0.8 + toolBonus - durationPenalty - stderrPenalty - dangerousPenalty - substitutionPenalty - xargsPenalty);
}

function scoreArtistryRaw(features: ShellCommandFeatures) {
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

function weightedBreakdown(rawScores: ShellgeiScore["breakdown"], weights: ShellgeiScore["breakdown"]) {
    return {
        conciseness: Math.round(rawScores.conciseness * weights.conciseness),
        shellness: Math.round(rawScores.shellness * weights.shellness),
        ingenuity: Math.round(rawScores.ingenuity * weights.ingenuity),
        readability: Math.round(rawScores.readability * weights.readability),
        robustness: Math.round(rawScores.robustness * weights.robustness),
        artistry: Math.round(rawScores.artistry * weights.artistry)
    };
}

function buildNotes(features: ShellCommandFeatures) {
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

function buildPenalties(command: string, features: ShellCommandFeatures) {
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

export async function scoreShellgeiCandidate(candidate: WorkerCandidate, options: { mode?: ShellgeiScoreMode } = {}): Promise<ShellgeiScore | null> {
    if (!candidate.finalCheck?.passed) {
        return null;
    }
    const command = candidate.command ?? "";
    const mode = normalizeMode(options.mode ?? DEFAULT_MODE);
    const features = await analyzeShellCommand(command);
    const rawScores = {
        conciseness: scoreConcisenessRaw(command),
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
