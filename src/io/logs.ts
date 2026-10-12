import type { SolveSession, SolveAttempt, WorkerCandidate, WorkerSummary, CandidateFinalCheck, JudgeScoreBreakdown, ShellgeiScore } from "../types.js";
import type { selectSolveOutcome } from "../solve/selection.js";
import { writeFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { publicLlmSnapshot } from "../providers/llm.js";
import { readJson } from "../shared.js";
type Selection = ReturnType<typeof selectSolveOutcome>;
interface WriteSolveLogInput {
    logsDir: string;
    session: SolveSession;
    summary: {
        finishedAt: string;
        selectedCandidateId: string | null;
        stopReason?: string | null;
        workerSummaries?: WorkerSummary[];
        selectorReason?: string;
        selectorScore?: Selection["score"];
        selectorMetrics?: Selection["metrics"];
    };
    attempts: SolveAttempt[];
    candidates: WorkerCandidate[];
    workerSummaries?: WorkerSummary[];
    finalCheck: CandidateFinalCheck;
}
// Saved logs predate the current domain contracts. Keep their scalar metadata as
// unknown, and validate the containers we traverse without rewriting the payload.
export interface SavedScore {
    value?: unknown;
    breakdown?: Partial<Record<keyof JudgeScoreBreakdown | keyof ShellgeiScore["breakdown"], unknown>> | null;
    notes?: unknown[] | null;
    penalties?: unknown[] | null;
}
interface SavedFinalCheck {
    passed?: unknown;
    iterations?: unknown;
    engine?: unknown;
    reason?: unknown;
    score?: SavedScore | null;
}
interface SavedAttempt {
    command?: unknown;
    explanation?: unknown;
}
interface SavedCandidate {
    candidateId?: unknown;
    workerId?: unknown;
    command?: unknown;
    output?: unknown;
    explanation?: unknown;
    finalCheck?: SavedFinalCheck | null;
    shellgeiScore?: SavedScore | null;
    score?: SavedScore | null;
    attempts?: SavedAttempt[] | null;
}
interface SavedSelector {
    name?: unknown;
    reason?: unknown;
    selectedCandidateId?: unknown;
    score?: SavedScore | null;
    metrics?: Partial<Record<"totalScore" | "shellgeiScore" | "judgeScore" | "outputConsensus" | "stdoutConsistency" | "totalDurationMs" | "iterationCount" | "commandLength" | "explanationLength", unknown>> | null;
}
interface SavedPlan {
    knowledgeMode?: unknown;
    workerTasks?: {
        workerId?: unknown;
        assignedVariant?: {
            toolBias?: unknown[] | null;
        } | null;
    }[] | null;
    planner?: {
        provider?: unknown;
        attemptedProvider?: unknown;
        fallbackReason?: unknown;
    } | null;
}
export interface SavedLogData {
    command?: unknown;
    output?: unknown;
    explanation?: unknown;
    mode?: unknown;
    engine?: unknown;
    sessionId?: unknown;
    startedAt?: unknown;
    finishedAt?: unknown;
    problem?: unknown;
    rawProblem?: unknown;
    selectedCandidateId?: unknown;
    stopReason?: unknown;
    workdir?: unknown;
    knowledgeMode?: unknown;
    attempts?: SavedAttempt[] | null;
    candidates?: SavedCandidate[] | null;
    finalCheck?: SavedFinalCheck | null;
    selector?: SavedSelector | null;
    runner?: {
        name?: unknown;
        limits?: unknown;
        sandboxPolicy?: unknown;
    } | null;
    plan?: SavedPlan | null;
    planner?: SavedPlan | null;
    problemSpec?: {
        raw?: unknown;
        problemText?: unknown;
        metadata?: unknown;
    } | null;
}
export type LogDisplayResult = SavedLogData & {
    logPath?: string;
};
export type LogSummary = ReturnType<typeof summarizeLog>;
export interface ListLogsOptions {
    logsDir?: string;
    limit?: number;
}
export interface SearchLogsOptions extends ListLogsOptions {
    query?: string;
    mode?: string;
    passed?: boolean;
}
export interface PruneLogsOptions {
    logsDir?: string;
    retainDays: number;
    now?: Date;
    dryRun?: boolean;
}
export type PruneLogsResult = Awaited<ReturnType<typeof pruneSavedLogs>>;
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
type ContainerCheck = (value: Record<string, unknown>) => boolean;
function optionalRecord(value: unknown, check: ContainerCheck = () => true): boolean {
    return value == null || (isRecord(value) && check(value));
}
function optionalArray(value: unknown, check: (item: unknown) => boolean = () => true): boolean {
    return value == null || (Array.isArray(value) && value.every(check));
}
function validScore(value: unknown): boolean {
    return optionalRecord(value, score => optionalRecord(score.breakdown) && optionalArray(score.notes) && optionalArray(score.penalties));
}
function validFinalCheck(value: unknown): boolean { return optionalRecord(value, check => validScore(check.score)); }
function validAttempts(value: unknown): boolean { return optionalArray(value, isRecord); }
function validPlan(value: unknown): boolean {
    return optionalRecord(value, plan => optionalRecord(plan.planner) && optionalArray(plan.workerTasks, task => isRecord(task) && optionalRecord(task.assignedVariant, variant => optionalArray(variant.toolBias))));
}
function validateSavedLog(value: unknown, logPath: string): SavedLogData {
    // Historical logs may store a selector name as a scalar. The catalog has
    // always used its default selector when no object fields are available.
    const selector = isRecord(value) && isRecord(value.selector) ? value.selector : undefined;
    if (!isRecord(value) || !validAttempts(value.attempts) || !validFinalCheck(value.finalCheck) ||
        !optionalArray(value.candidates, candidate => isRecord(candidate) && validFinalCheck(candidate.finalCheck) &&
            validScore(candidate.shellgeiScore) && validScore(candidate.score) && validAttempts(candidate.attempts)) ||
        !optionalRecord(selector, selector => validScore(selector.score) && optionalRecord(selector.metrics)) ||
        !optionalRecord(value.runner) || !optionalRecord(value.problemSpec) || !validPlan(value.plan) || !validPlan(value.planner)) {
        throw new Error(`Invalid saved log structure: ${logPath}.`);
    }
    // All accessed containers were checked; leaves deliberately remain unknown.
    return { ...value, selector } as SavedLogData;
}
function buildKnowledgeSnapshot(session: SolveSession) {
    const snapshot = session.knowledgeSnapshot;
    if (!snapshot)
        return { mode: session.knowledgeMode ?? "off" };
    return {
        mode: session.knowledgeMode,
        provider: snapshot.provider,
        model: snapshot.model,
        inputProfile: snapshot.inputProfile,
        dbPath: snapshot.dbPath,
        dimensions: snapshot.dimensions,
        generationId: snapshot.generationId,
        datasetFingerprint: snapshot.datasetFingerprint
    };
}
function buildRunnerSnapshot(session: SolveSession) {
    return {
        name: session.runner.name ?? "local",
        image: "image" in session.runner ? session.runner.image : undefined,
        limits: session.runnerLimits,
        sandboxPolicy: session.sandboxPolicy,
        writableWorkdir: session.writableWorkdir ?? false,
        dockerDevicesReadonly: session.dockerDevicesReadonly ?? []
    };
}
async function writeSessionLog(logsDir: string, prefix: string, startedAt: string, payload: unknown) {
    const logId = startedAt.replace(/[:.]/g, "-");
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    let sequence = 0;
    while (true) {
        const suffix = sequence === 0 ? "" : `-${sequence + 1}`;
        const filename = `${prefix}-${logId}${suffix}.json`;
        const logPath = path.join(logsDir, filename);
        try {
            await writeFile(logPath, content, { encoding: "utf8", flag: "wx" });
            return { logId: `${logId}${suffix}`, logPath };
        }
        catch (error) {
            if (error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "EEXIST") {
                sequence += 1;
                continue;
            }
            throw error;
        }
    }
}
export async function writeSolveSessionLog({ logsDir, session, summary, attempts, candidates, workerSummaries, finalCheck }: WriteSolveLogInput) {
    return await writeSessionLog(logsDir, "solve", summary.finishedAt, {
        sessionId: session.sessionId,
        mode: "solve",
        problem: session.problem.problemText,
        rawProblem: session.problem.raw,
        problemSpec: session.problem,
        engine: session.engine?.name ?? "unknown",
        ...(session.llmConfig ? { llm: publicLlmSnapshot(session.llmConfig) } : {}),
        iterations: attempts.length,
        attempts,
        candidates,
        workerSummaries: workerSummaries ?? [],
        finalCheck,
        selectedCandidateId: summary.selectedCandidateId,
        stopReason: summary.stopReason ?? null,
        selector: summary.selectedCandidateId == null
            ? {
                name: session.selectorName,
                reason: "No candidate was selected.",
                selectedCandidateId: null,
                score: null,
                metrics: null
            }
            : {
                name: session.selectorName,
                reason: summary.selectorReason ?? "Selector details were not captured.",
                selectedCandidateId: summary.selectedCandidateId,
                score: summary.selectorScore ?? null,
                metrics: summary.selectorMetrics ?? null
            },
        startedAt: session.startedAt,
        finishedAt: summary.finishedAt,
        workdir: session.workdir,
        runner: buildRunnerSnapshot(session),
        shellgeiScoreMode: session.shellgeiScoreMode,
        knowledge: buildKnowledgeSnapshot(session),
        plan: session.plan ?? null,
        planner: session.plan?.planner ?? null
    });
}
function getDefaultLogsDir() {
    return path.join(process.cwd(), "logs");
}
function hasPathSyntax(logRef: string) {
    return logRef.includes("/") || logRef.includes("\\") || logRef.endsWith(".json");
}
function inferMode(filename: string, payload: SavedLogData) {
    if (typeof payload.mode === "string" && payload.mode.length > 0) {
        return payload.mode;
    }
    if (filename.startsWith("solve-")) {
        return "solve";
    }
    if (filename.startsWith("check-")) {
        return "check";
    }
    return "unknown";
}
function summarizeLog(filename: string, logPath: string, payload: SavedLogData, fileStat: {
    mtimeMs: number;
}) {
    const command = payload.command ?? payload.candidates?.[0]?.command ?? payload.attempts?.[0]?.command ?? "";
    return {
        logId: path.basename(filename, ".json"),
        filename,
        logPath,
        mode: inferMode(filename, payload),
        sessionId: payload.sessionId ?? null,
        startedAt: payload.startedAt ?? null,
        finishedAt: payload.finishedAt ?? null,
        problem: payload.problem ?? payload.problemSpec?.problemText ?? "",
        command,
        selectedCandidateId: payload.selectedCandidateId ?? null,
        passed: payload.finalCheck?.passed ?? null,
        mtimeMs: fileStat.mtimeMs
    };
}
function sortLogsDescending(left: LogSummary, right: LogSummary) {
    const leftKey = Date.parse(String(left.finishedAt ?? left.startedAt ?? "")) || left.mtimeMs;
    const rightKey = Date.parse(String(right.finishedAt ?? right.startedAt ?? "")) || right.mtimeMs;
    if (leftKey !== rightKey) {
        return rightKey - leftKey;
    }
    return right.filename.localeCompare(left.filename);
}
async function loadLogSummaries(logsDir: string) {
    let entries;
    try {
        entries = await readdir(logsDir, { withFileTypes: true });
    }
    catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    const summaries = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
        const logPath = path.join(logsDir, entry.name);
        const [payload, fileStat] = await Promise.all([readJson(logPath), stat(logPath)]);
        return summarizeLog(entry.name, logPath, validateSavedLog(payload, logPath), fileStat);
    }));
    return summaries.sort(sortLogsDescending);
}
async function resolveLogPath(logRef: string) {
    if (hasPathSyntax(logRef)) {
        return path.resolve(process.cwd(), logRef);
    }
    const logsDir = getDefaultLogsDir();
    const entries = await readdir(logsDir, { withFileTypes: true });
    const matches = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .filter((name) => name === logRef || name === `${logRef}.json` || name.endsWith(`-${logRef}.json`));
    if (matches.length === 0) {
        throw new Error(`No saved log matched '${logRef}' in ${logsDir}.`);
    }
    if (matches.length > 1) {
        throw new Error(`Multiple saved logs matched '${logRef}'. Please pass full filename or path.`);
    }
    return path.join(logsDir, matches[0]);
}
function buildFallbackFinalCheck(log: SavedLogData, command: unknown) {
    return (log.finalCheck ?? {
        passed: false,
        iterations: Array.isArray(log.attempts) ? log.attempts.length : 0,
        engine: log.engine ?? log.mode ?? "unknown",
        reason: command ? "Saved log did not contain final check." : "Saved log did not contain a result.",
        score: null
    });
}
function buildSelector(log: SavedLogData, selectedCandidate: SavedCandidate | null, finalCheck: SavedFinalCheck, logPath: string) {
    const loadedReason = `Loaded saved log ${logPath}.`;
    if (log.selector && typeof log.selector === "object") {
        return {
            name: log.selector.name ?? "first-pass-wins",
            reason: log.selector.reason ?? loadedReason,
            selectedCandidateId: log.selector.selectedCandidateId ?? selectedCandidate?.candidateId ?? null,
            score: log.selector.score ?? selectedCandidate?.finalCheck?.score ?? finalCheck.score ?? null,
            metrics: log.selector.metrics ?? null
        };
    }
    return {
        name: "first-pass-wins",
        reason: loadedReason,
        selectedCandidateId: selectedCandidate?.candidateId ?? null,
        score: selectedCandidate?.finalCheck?.score ?? finalCheck.score ?? null,
        metrics: null
    };
}
function restoreResultFromLog(log: SavedLogData, logPath: string) {
    const selectedCandidateId = log.selector?.selectedCandidateId ?? log.selectedCandidateId ?? null;
    const selectedCandidate = (log.candidates ?? []).find((candidate) => candidate.candidateId === selectedCandidateId) ??
        (log.candidates ?? [])[0] ??
        null;
    const command = selectedCandidate?.command ?? log.command ?? "";
    const output = selectedCandidate?.output ?? log.output ?? "";
    const explanation = selectedCandidate?.explanation ??
        log.explanation ??
        log.attempts?.[0]?.explanation ??
        "Loaded a saved session log.";
    const finalCheck = selectedCandidate?.finalCheck ?? buildFallbackFinalCheck(log, command);
    return {
        command,
        output,
        explanation,
        attempts: log.attempts ?? selectedCandidate?.attempts ?? [],
        candidates: log.candidates ?? (selectedCandidate ? [selectedCandidate] : []),
        finalCheck,
        selector: buildSelector(log, selectedCandidate, finalCheck, logPath),
        runner: log.runner ?? { name: "local", limits: {}, sandboxPolicy: {} },
        stopReason: log.stopReason ?? null,
        plan: log.plan ?? log.planner ?? null,
        workdir: log.workdir ?? "",
        problem: log.problemSpec ??
            {
                raw: log.rawProblem ?? log.problem ?? "",
                problemText: log.problem ?? log.rawProblem ?? "",
                metadata: { format: "plain-text" }
            },
        logPath
    };
}
export async function listSavedLogs({ logsDir = getDefaultLogsDir(), limit }: ListLogsOptions = {}) {
    const summaries = await loadLogSummaries(logsDir);
    return typeof limit === "number" ? summaries.slice(0, limit) : summaries;
}
export async function searchSavedLogs({ query, logsDir = getDefaultLogsDir(), mode, passed, limit }: SearchLogsOptions = {}) {
    const normalizedQuery = query?.trim().toLowerCase() ?? "";
    const summaries = await loadLogSummaries(logsDir);
    const filtered = summaries.filter((summary) => {
        if (mode != null && summary.mode !== mode) {
            return false;
        }
        if (passed != null && summary.passed !== passed) {
            return false;
        }
        if (normalizedQuery.length === 0) {
            return true;
        }
        const haystack = [
            summary.logId,
            summary.filename,
            summary.problem,
            summary.command,
            summary.selectedCandidateId ?? ""
        ]
            .join("\n")
            .toLowerCase();
        return haystack.includes(normalizedQuery);
    });
    return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}
export async function pruneSavedLogs({ logsDir = getDefaultLogsDir(), retainDays, now = new Date(), dryRun = false }: PruneLogsOptions) {
    if (!Number.isFinite(retainDays) || retainDays < 0) {
        throw new Error("retainDays must be a non-negative number.");
    }
    const cutoffAt = new Date(now.getTime() - retainDays * 24 * 60 * 60 * 1000);
    const summaries = await loadLogSummaries(logsDir);
    const deleted = [];
    const kept = [];
    for (const summary of summaries) {
        const referenceTime = Date.parse(String(summary.finishedAt ?? summary.startedAt ?? "")) || summary.mtimeMs;
        if (referenceTime < cutoffAt.getTime()) {
            deleted.push(summary);
            if (!dryRun) {
                await rm(summary.logPath, { force: true });
            }
        }
        else {
            kept.push(summary);
        }
    }
    return {
        cutoffAt: cutoffAt.toISOString(),
        deleted,
        kept,
        deletedCount: deleted.length,
        keptCount: kept.length,
        dryRun
    };
}
export async function showSavedLog(logRef: string) {
    const logPath = await resolveLogPath(logRef);
    const log = await readJson(logPath);
    return restoreResultFromLog(validateSavedLog(log, logPath), logPath);
}
