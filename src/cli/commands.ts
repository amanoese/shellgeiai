import type { SolveProblemOptions, KnowledgeHit, ManProfileName } from "../types.js";
import type { SolveRuntimeOptions } from "../solve/runtime.js";
import type { ProgressMode } from "../io/progress.js";
import type { LogDisplayResult, SavedScore, LogSummary, ListLogsOptions, SearchLogsOptions, PruneLogsOptions, PruneLogsResult } from "../io/logs.js";
import { createProgressReporter } from "../io/progress.js";
import { createSolveRuntime } from "../solve/runtime.js";
import { solveProblem } from "../solve/solve.js";
import { searchSavedLogs, listSavedLogs, showSavedLog, pruneSavedLogs } from "../io/logs.js";
import { buildKnowledgeVectors, prepareKnowledgeModel, searchKnowledge } from "../knowledge/commands.js";
export type SolveCommandOptions = Pick<SolveProblemOptions, "mode" | "parallelism" | "selector" | "writableWorkdir" | "dockerDevicesReadonly" | "knowledgeModel"> & {
    problem: string;
    engine?: SolveRuntimeOptions["engine"];
    runner?: string;
    maxIter: number;
    workdir?: string;
    timeBudget?: number;
    commandPolicy?: string;
    sandboxPolicy?: string;
    knowledge?: SolveProblemOptions["knowledgeMode"];
    knowledgeDataset?: string;
    knowledgeDb?: string;
    progress?: ProgressMode;
    llmBaseUrl?: string;
    llmModel?: string;
    plannerModel?: string;
    llmTimeout?: number;
    llmMaxRetries?: number;
    shellgeiScoreMode?: SolveProblemOptions["shellgeiScoreMode"];
};
export interface KnowledgeCommandOptions {
    model?: string;
    knowledgeModel?: string;
    dataset?: string;
    db?: string;
    batchSize?: number;
    force?: boolean;
    topK?: number;
    query?: string;
}
export interface ManCommandOptions {
    output?: string;
    profile?: ManProfileName;
    sections?: string;
    commands?: string;
    limit?: number;
    locale?: string;
    man?: string;
}
interface ManKnowledgeArgs {
    commands: string[] | null;
    help: boolean;
    limit: number | null;
    locale: string;
    manCommand: string;
    output: string;
    profile: ManProfileName;
    sections: string[] | "all" | null;
}
interface ManScriptModule {
    parseArgs(argv: string[]): ManKnowledgeArgs;
    buildManKnowledge(options: ManKnowledgeArgs): Promise<{
        records: number;
        output: string;
    }>;
}
function asManScriptModule(value: unknown): ManScriptModule {
    if (!value || typeof value !== "object" || !("parseArgs" in value) || typeof value.parseArgs !== "function" ||
        !("buildManKnowledge" in value) || typeof value.buildManKnowledge !== "function") {
        throw new Error("Man knowledge script must export parseArgs and buildManKnowledge functions.");
    }
    return value as ManScriptModule;
}
export async function runSolveCommand(options: SolveCommandOptions) {
    const progressReporter = createProgressReporter(options.progress);
    try {
        const runtime = createSolveRuntime({
            engine: options.engine,
            runner: options.runner,
            llm: {
                baseURL: options.llmBaseUrl,
                model: options.llmModel,
                plannerModel: options.plannerModel,
                timeoutMs: options.llmTimeout,
                maxRetries: options.llmMaxRetries
            }
        });
        const result = await solveProblem({
            problemInput: options.problem,
            engine: runtime.engine,
            runner: runtime.runner,
            judge: runtime.judge,
            plannerProvider: runtime.plannerProvider,
            llmConfig: runtime.llmConfig,
            maxIterations: options.maxIter,
            requestedWorkdir: options.workdir,
            mode: options.mode,
            parallelism: options.parallelism,
            selector: options.selector,
            timeBudgetMs: options.timeBudget,
            writableWorkdir: options.writableWorkdir,
            dockerDevicesReadonly: options.dockerDevicesReadonly,
            commandPolicyPath: options.commandPolicy,
            sandboxPolicyPath: options.sandboxPolicy,
            knowledgeMode: options.knowledge,
            knowledgeModel: options.knowledgeModel,
            knowledgeDatasetPath: options.knowledgeDataset,
            knowledgeDbPath: options.knowledgeDb,
            onProgress: progressReporter
        });
        process.stdout.write(`${formatResult(result)}\n`);
        process.exitCode = result.finalCheck.passed ? 0 : 1;
    }
    finally {
        progressReporter?.cleanup?.();
    }
}
export async function runLogsSearchCommand(options: SearchLogsOptions) {
    const logs = await searchSavedLogs({
        query: options.query,
        mode: options.mode,
        passed: options.passed,
        limit: options.limit
    });
    process.stdout.write(`${formatLogSummaries(logs, `LOGS MATCHING: ${options.query}`)}\n`);
    process.exitCode = 0;
}
export async function runLogsListCommand(options: ListLogsOptions) {
    const logs = await listSavedLogs({
        limit: options.limit
    });
    process.stdout.write(`${formatLogSummaries(logs, "LOGS:")}\n`);
    process.exitCode = 0;
}
export async function runLogsShowCommand(options: {
    logRef: string;
}) {
    const result = await showSavedLog(options.logRef);
    process.stdout.write(`${formatResult(result)}\n`);
    process.exitCode = result.finalCheck.passed ? 0 : 1;
}
export async function runLogsPruneCommand(options: PruneLogsOptions) {
    const result = await pruneSavedLogs({
        retainDays: options.retainDays,
        dryRun: options.dryRun
    });
    process.stdout.write(`${formatPruneResult(result)}\n`);
    process.exitCode = 0;
}
// The standalone script is packaged alongside dist, outside the compiler's rootDir.
const { buildManKnowledge, parseArgs: parseManKnowledgeArgs } = asManScriptModule(await import(new URL("../../scripts/build-man-knowledge.js", import.meta.url).href));
function resolveModel(options: KnowledgeCommandOptions) {
    return options.model ?? options.knowledgeModel;
}
export async function runKnowledgePrepareCommand(options: KnowledgeCommandOptions) {
    const result = await prepareKnowledgeModel({ model: resolveModel(options) });
    process.stdout.write(`Knowledge API/native check passed: ${result.model} dimensions=${result.dimensions} provider=${result.provider}\n`);
}
export async function runKnowledgeBuildCommand(options: KnowledgeCommandOptions) {
    const model = resolveModel(options);
    const result = await buildKnowledgeVectors({
        datasetPath: options.dataset,
        model,
        dbPath: options.db,
        batchSize: options.batchSize,
        force: options.force
    });
    process.stdout.write(`Knowledge database ${result.reused ? "reused" : "built"}: ${result.itemCount} items -> ${result.dbPath}\n` +
        `model: ${result.model}\ndimensions: ${result.dimensions}\ngeneration: ${result.generationId}\n`);
}
function toManKnowledgeArgs(options: ManCommandOptions) {
    const optionNames = ["output", "profile", "sections", "commands", "limit", "locale"] as const;
    const args = [];
    for (const optionName of optionNames) {
        if (options[optionName] == null)
            continue;
        args.push(`--${optionName}`, String(options[optionName]));
    }
    if (options.man != null)
        args.push("--man", String(options.man));
    return args;
}
export async function runKnowledgeManCommand(options: ManCommandOptions, { buildManKnowledge: build = buildManKnowledge, parseManKnowledgeArgs: parse = parseManKnowledgeArgs }: {
    buildManKnowledge?: ManScriptModule["buildManKnowledge"];
    parseManKnowledgeArgs?: ManScriptModule["parseArgs"];
} = {}) {
    const result = await build(parse(toManKnowledgeArgs(options)));
    process.stdout.write(`Man knowledge built: ${result.records} records -> ${result.output}\n`);
}
function formatKnowledgeSearchResult(record: KnowledgeHit, index: number) {
    const lines = [
        `${index + 1}. ${record.id} score=${record.score.toFixed(4)}`,
        `  kind: ${record.kind}`
    ];
    if (record.command)
        lines.push(`  command: ${record.command}`);
    if (record.option)
        lines.push(`  option: ${record.option}`);
    lines.push(`  text: ${record.text}`);
    if (record.source)
        lines.push(`  source: ${record.source}`);
    return lines.join("\n");
}
export async function runKnowledgeSearchCommand(options: KnowledgeCommandOptions) {
    const model = resolveModel(options);
    const result = await searchKnowledge({
        query: options.query,
        datasetPath: options.dataset,
        model,
        topK: options.topK,
        dbPath: options.db
    });
    const lines = [
        `Knowledge search: ${result.query}`,
        `model: ${result.model}`,
        `database: ${result.dbPath}`,
        ...result.results.map(formatKnowledgeSearchResult)
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
}
function formatJudgeBreakdown(score: SavedScore | null | undefined) {
    return `correctness=${score?.breakdown?.correctness ?? 0}, stdout=${score?.breakdown?.stdoutQuality ?? 0}, stderr=${score?.breakdown?.stderrQuality ?? 0}, expected=${score?.breakdown?.expectedOutput ?? 0}`;
}
function formatShellgeiBreakdown(score: SavedScore | null | undefined) {
    return `conciseness=${score?.breakdown?.conciseness ?? 0}, shellness=${score?.breakdown?.shellness ?? 0}, ingenuity=${score?.breakdown?.ingenuity ?? 0}, readability=${score?.breakdown?.readability ?? 0}, robustness=${score?.breakdown?.robustness ?? 0}, artistry=${score?.breakdown?.artistry ?? 0}`;
}
function formatWorkerVariantLines(result: LogDisplayResult) {
    const workerTasks = result.plan?.workerTasks ?? [];
    const candidates = result.candidates ?? [];
    const knowledgeMode = result.knowledgeMode ?? result.plan?.knowledgeMode ?? "off";
    if (workerTasks.length === 0) {
        return ["(none)"];
    }
    return workerTasks.map((task) => {
        const candidate = candidates.find((entry) => entry.workerId === task.workerId || entry.candidateId === task.workerId);
        const score = candidate?.shellgeiScore?.value ??
            candidate?.finalCheck?.score?.value ??
            candidate?.score?.value ??
            0;
        const toolBias = task.assignedVariant?.toolBias ?? [];
        return [
            task.workerId,
            `score: ${score}`,
            `knowledge: ${knowledgeMode}`,
            `[${toolBias.join(",")}]`,
            candidate?.command ?? "(no-command)"
        ].join(" # ");
    });
}
export function formatResult(result: LogDisplayResult) {
    const status = result.finalCheck?.passed ? "passed" : "failed";
    const selectedScore = result.selector?.score;
    const selectedCandidate = result.candidates?.find((candidate) => candidate.candidateId === result.selector?.selectedCandidateId);
    const selectedShellgeiScore = selectedCandidate?.shellgeiScore;
    const selectorMetrics = result.selector?.metrics;
    const passingCandidates = (result.candidates ?? []).filter((candidate) => candidate.finalCheck?.passed);
    const plannerInfo = result.plan?.planner ?? null;
    const workerVariantLines = formatWorkerVariantLines(result);
    return [
        "COMMAND:",
        result.command || "(none)",
        "",
        "EXPLANATION:",
        result.explanation || "(none)",
        "",
        "CHECK:",
        `status: ${status}`,
        `iterations: ${result.finalCheck?.iterations ?? 0}`,
        `engine: ${result.finalCheck?.engine ?? "(unknown)"}`,
        `workers: ${result.plan?.workerTasks?.length ?? 0}`,
        `stop-reason: ${result.stopReason ?? "(none)"}`,
        `selector: ${result.selector?.name ?? "(none)"}`,
        `selected-candidate: ${result.selector?.selectedCandidateId ?? "(none)"}`,
        `selected-score: ${selectedScore?.value ?? 0}`,
        `score-breakdown: ${formatJudgeBreakdown(selectedScore)}`,
        `selected-shellgei-score: ${selectedShellgeiScore?.value ?? 0}`,
        `shellgei-breakdown: ${formatShellgeiBreakdown(selectedShellgeiScore)}`,
        `shellgei-notes: ${(selectedShellgeiScore?.notes ?? []).join(", ") || "(none)"}`,
        `shellgei-penalties: ${(selectedShellgeiScore?.penalties ?? []).join(", ") || "(none)"}`,
        `selector-reason: ${result.selector?.reason ?? "(none)"}`,
        selectorMetrics
            ? `selector-metrics: total=${selectorMetrics.totalScore ?? 0}, shellgei=${selectorMetrics.shellgeiScore ?? 0}, judge=${selectorMetrics.judgeScore ?? 0}, consensus=${selectorMetrics.outputConsensus ?? 0}, stdout=${selectorMetrics.stdoutConsistency ?? 0}, duration=${selectorMetrics.totalDurationMs ?? 0}, iterations=${selectorMetrics.iterationCount ?? 0}, command-length=${selectorMetrics.commandLength ?? 0}, explanation-length=${selectorMetrics.explanationLength ?? 0}`
            : "selector-metrics: (none)",
        `planner-provider: ${plannerInfo?.provider ?? "(none)"}`,
        `planner-attempted-provider: ${plannerInfo?.attemptedProvider ?? "(none)"}`,
        `planner-fallback-reason: ${plannerInfo?.fallbackReason ?? "(none)"}`,
        `passing-candidates: ${passingCandidates.length}`,
        "",
        "WORKER VARIANTS:",
        ...workerVariantLines,
        "",
        "RUNNER:",
        `name: ${result.runner?.name ?? "(unknown)"}`,
        `sandbox: ${JSON.stringify(result.runner?.sandboxPolicy ?? null)}`,
        "",
        "LOG:",
        result.logPath ?? "(none)"
    ].join("\n");
}
function formatMaybe(value: unknown, fallback = "(none)") {
    return value == null || value === "" ? fallback : String(value);
}
export function formatLogSummary(summary: LogSummary) {
    const status = summary.passed == null ? "unknown" : summary.passed ? "passed" : "failed";
    const parts = [
        summary.logId,
        summary.mode,
        status,
        `selected=${formatMaybe(summary.selectedCandidateId)}`,
        `problem=${formatMaybe(summary.problem)}`,
        `command=${formatMaybe(summary.command)}`
    ];
    return parts.join(" | ");
}
export function formatLogSummaries(summaries: LogSummary[], heading: string) {
    const lines = [heading];
    if (summaries.length === 0) {
        lines.push("(no saved logs)");
        return lines.join("\n");
    }
    for (const summary of summaries) {
        lines.push(formatLogSummary(summary));
    }
    return lines.join("\n");
}
export function formatPruneResult(result: PruneLogsResult) {
    const lines = [
        "PRUNE:",
        `cutoff-at: ${result.cutoffAt}`,
        `deleted-count: ${result.deletedCount}`,
        `kept-count: ${result.keptCount}`
    ];
    if (result.deleted.length > 0) {
        lines.push("", "DELETED:");
        for (const summary of result.deleted) {
            lines.push(formatLogSummary(summary));
        }
    }
    if (result.kept.length > 0) {
        lines.push("", "KEPT:");
        for (const summary of result.kept) {
            lines.push(formatLogSummary(summary));
        }
    }
    return lines.join("\n");
}
