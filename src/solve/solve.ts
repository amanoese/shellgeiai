import type { SolveProblemOptions, SolveSession, InitializingSolveSession, ExecutionSummary, ExecutionPlan, ProblemSpec, PlanVariant, WorkerTask, KnowledgeRuntime } from "../types.js";
function readPlannerProperty(value: unknown, key: string): unknown { return value == null ? undefined : Reflect.get(Object(value), key); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
import { writeSolveSessionLog } from "../io/logs/writer.js";
import { runSolveOrchestrator } from "./orchestrator.js";
import { scoreShellgeiCandidate, selectSolveOutcome } from "./selection.js";
import { reportSessionPhase } from "./events.js";
import path from "node:path";
import { DEFAULT_KNOWLEDGE_MODEL } from "../knowledge/modelConfig.js";
import { normalizeKnowledgeMode, usesPlannerKnowledge, usesWorkerKnowledge } from "../knowledge/mode.js";
import { createKnowledgeRuntime } from "../knowledge/knowledgeRuntime.js";
import { awaitWithSignal, ensureDirectory, resolveRequestedWorkdir } from "../shared.js";
import { DEFAULT_KNOWLEDGE_DATASET, resolveKnowledgeDbPath } from "../knowledge/knowledgePaths.js";
import { createSearchKnowledgeTool } from "../knowledge/searchKnowledgeTool.js";
import { createDefaultRunnerLimits, loadCommandPolicy, loadSandboxPolicy } from "../execution/safety.js";
import { normalizeReadonlyDockerDevices } from "../execution/dockerRunner.js";
import { createToolRegistry } from "./tools.js";
import { createLlmPlanner, llmPlanner, plannerResultSchema } from "../providers/planner.js";
import { resolveLlmConfig } from "../providers/llm.js";

export async function solveProblem(options: SolveProblemOptions) {
    const session = await createSolveSession({
        ...options,
        knowledgeMode: options.knowledgeMode,
        knowledgeModel: options.knowledgeModel,
        knowledgeDatasetPath: options.knowledgeDatasetPath,
        knowledgeDbPath: options.knowledgeDbPath,
        knowledgeEmbedder: options.knowledgeEmbedder,
        knowledgeEmbedderFactory: options.knowledgeEmbedderFactory
    });
    try {
        const execution = await runSolveOrchestrator(session);
        return await finalizeSolve(session, execution);
    }
    finally {
        await session.dispose();
    }
}

async function finalizeSolve(session: SolveSession, execution: ExecutionSummary) {
    reportSessionPhase(session, "selecting", "Selecting final candidate.");
    const finishedAt = new Date().toISOString();
    const candidates = await Promise.all(execution.candidates.map(async (candidate) => candidate.finalCheck?.passed
        ? {
            ...candidate,
            shellgeiScore: await scoreShellgeiCandidate(candidate, {
                mode: session.shellgeiScoreMode
            })
        }
        : candidate));
    const selection = selectSolveOutcome(candidates, session.selectorName);
    const selectedCandidate = selection.selectedCandidate;
    const finalCheck = selectedCandidate?.finalCheck ?? {
        passed: false,
        iterations: execution.attempts.length,
        engine: session.engine.name,
        reason: "No candidate was produced.",
        score: null
    };
    reportSessionPhase(session, "logging", "Writing session log.");
    const { logPath } = await writeSolveSessionLog({
        logsDir: session.logsDir,
        session,
        summary: {
            finishedAt,
            selectedCandidateId: selectedCandidate?.candidateId ?? null,
            stopReason: execution.stopReason,
            workerSummaries: execution.workerSummaries,
            selectorReason: selection.reason,
            selectorScore: selection.score,
            selectorMetrics: selection.metrics
        },
        attempts: execution.attempts,
        candidates,
        workerSummaries: execution.workerSummaries,
        finalCheck
    });
    reportSessionPhase(session, "completed", "Solve completed.");
    return {
        command: selectedCandidate?.command ?? "",
        output: selectedCandidate?.output ?? "",
        explanation: selectedCandidate?.explanation ?? "No explanation provided.",
        attempts: execution.attempts,
        candidates,
        workerSummaries: execution.workerSummaries,
        finalCheck,
        selector: {
            name: selection.selector,
            reason: selection.reason,
            selectedCandidateId: selectedCandidate?.candidateId ?? null,
            score: selection.score,
            metrics: selection.metrics
        },
        runner: {
            name: session.runner.name ?? "local",
            limits: session.runnerLimits,
            sandboxPolicy: session.sandboxPolicy,
            writableWorkdir: session.writableWorkdir,
            dockerDevicesReadonly: session.dockerDevicesReadonly ?? []
        },
        knowledgeMode: session.knowledgeMode,
        stopReason: execution.stopReason ?? null,
        workdir: session.workdir,
        problem: session.problem,
        logPath,
        plan: session.plan
    };
}

export async function createSolveSession(options: SolveProblemOptions): Promise<SolveSession> {
    const startedAt = new Date().toISOString();
    const sessionId = startedAt.replace(/[:.]/g, "-");
    const progressSession = {
        sessionId,
        onProgress: options.onProgress
    };
    reportSessionPhase(progressSession, "initializing", "Preparing session.");
    reportSessionPhase(progressSession, "problem-parsing", "Parsing problem input.");
    const problem = parseProblemInput(options.problemInput);
    const workdir = await resolveRequestedWorkdir(options.requestedWorkdir);
    const requestedDockerDevices = options.dockerDevicesReadonly ?? [];
    if (requestedDockerDevices.length > 0 && options.runner?.name !== "docker") {
        throw new Error("Read-only Docker devices require the Docker runner. Remove the device option or use --runner docker.");
    }
    const dockerDevicesReadonly = await normalizeReadonlyDockerDevices(requestedDockerDevices);
    const logsDir = path.join(process.cwd(), "logs");
    await ensureDirectory(logsDir);
    const commandPolicy = options.commandPolicy ?? (await loadCommandPolicy(options.commandPolicyPath));
    const sandboxPolicy = options.sandboxPolicy ?? (await loadSandboxPolicy(options.sandboxPolicyPath));
    const parallelism = Math.max(2, options.parallelism ?? 4);
    const llmConfig = options.llmConfig ?? options.engine?.llmConfig;
    const sessionConfig: Omit<InitializingSolveSession, "signal" | "dispose" | "plannerKnowledgeHints"> = {
        sessionId,
        startedAt,
        startedAtMs: Date.now(),
        problem,
        workdir,
        logsDir,
        engine: options.engine,
        runner: options.runner,
        judge: options.judge,
        maxIterations: options.maxIterations,
        mode: options.mode ?? "single",
        parallelism,
        selectorName: options.selector ?? "first-pass-wins",
        shellgeiScoreMode: options.shellgeiScoreMode ?? "simple",
        knowledgeMode: normalizeKnowledgeMode(options.knowledgeMode),
        knowledgeModel: options.knowledgeModel ?? DEFAULT_KNOWLEDGE_MODEL,
        knowledgeDatasetPath: path.resolve(options.knowledgeDatasetPath ?? DEFAULT_KNOWLEDGE_DATASET),
        knowledgeDbPath: path.resolve(resolveKnowledgeDbPath({
            dbPath: options.knowledgeDbPath,
            datasetPath: options.knowledgeDatasetPath ?? DEFAULT_KNOWLEDGE_DATASET,
            model: options.knowledgeModel ?? DEFAULT_KNOWLEDGE_MODEL
        })),
        timeBudgetMs: options.timeBudgetMs,
        deadlineAtMs: options.timeBudgetMs == null ? null : Date.now() + options.timeBudgetMs,
        runnerLimits: options.runnerLimits ?? createDefaultRunnerLimits(),
        writableWorkdir: options.writableWorkdir ?? false,
        dockerDevicesReadonly,
        commandPolicy,
        sandboxPolicy,
        onProgress: options.onProgress,
        llmConfig,
        plannerProvider: options.plannerProvider
    };
    if (usesWorkerKnowledge(sessionConfig.knowledgeMode) &&
        (sessionConfig.engine?.capabilities?.toolCalling !== true ||
            typeof sessionConfig.engine?.generateTurn !== "function")) {
        throw new Error(`Engine "${sessionConfig.engine?.name ?? "unknown"}" does not support Tool Calling required by --knowledge ${sessionConfig.knowledgeMode}. Use a Tool Calling capable engine, or select --knowledge planner/off.`);
    }
    if (sessionConfig.plannerProvider == null) {
        sessionConfig.llmConfig ??= resolveLlmConfig();
        sessionConfig.plannerProvider = createLlmPlanner({
            config: sessionConfig.llmConfig,
            client: options.engine?.client,
            clientFactory: options.engine?.clientFactory,
            fetchImpl: options.engine?.fetchImpl
        });
    }
    let ownedRuntime: KnowledgeRuntime | undefined;
    let disposed = false;
    const controller = new AbortController();
    const externalAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", externalAbort, { once: true });
    if (options.signal?.aborted)
        externalAbort();
    const timer = sessionConfig.deadlineAtMs == null ? null : setTimeout(() => controller.abort(new Error("Solve time budget exceeded.")), Math.max(0, sessionConfig.deadlineAtMs - Date.now()));
    timer?.unref?.();
    const session: InitializingSolveSession = {
        ...sessionConfig,
        signal: controller.signal,
        plannerKnowledgeHints: [],
        async dispose() {
            if (disposed) return;
            disposed = true;
            if (timer !== null) clearTimeout(timer);
            options.signal?.removeEventListener("abort", externalAbort);
            controller.abort(new Error("Solve session disposed."));
            await ownedRuntime?.dispose();
        }
    };

    try {
        controller.signal.throwIfAborted();
        if (options.knowledgeRetriever) {
            session.knowledgeRetriever = options.knowledgeRetriever;
        }
        else if (usesPlannerKnowledge(session.knowledgeMode) || usesWorkerKnowledge(session.knowledgeMode)) {
            ownedRuntime = await (options.knowledgeRuntimeFactory ?? createKnowledgeRuntime)({
                datasetPath: session.knowledgeDatasetPath,
                dbPath: session.knowledgeDbPath,
                model: session.knowledgeModel,
                embedder: options.knowledgeEmbedder,
                embedderFactory: options.knowledgeEmbedderFactory,
                signal: controller.signal
            });
            session.knowledgeRetriever = ownedRuntime.retriever;
            session.knowledgeSnapshot = ownedRuntime.snapshot;
        }
        if (usesWorkerKnowledge(session.knowledgeMode)) {
            session.toolRegistry = createToolRegistry();
            session.toolRegistry.register<{ query: string }>(createSearchKnowledgeTool({ retriever: session.knowledgeRetriever }));
        }
        if (usesPlannerKnowledge(session.knowledgeMode)) {
            const retriever = session.knowledgeRetriever;
            if (typeof retriever?.retrieveForPlanner !== "function") {
                throw new TypeError("session.knowledgeRetriever.retrieveForPlanner is not a function");
            }
            const retrieveForPlanner = retriever.retrieveForPlanner;
            session.plannerKnowledgeHints = await awaitWithSignal(() => retrieveForPlanner.call(retriever, {
                problem: session.problem.problemText,
                expectedOutput: session.problem.expectedOutput
            }), controller.signal);
        }
        controller.signal.throwIfAborted();
        reportSessionPhase(session, "planning", "Building execution plan.");
        const plan = { ...(await awaitWithSignal(() => createExecutionPlan(session), controller.signal)), knowledgeMode: session.knowledgeMode };
        controller.signal.throwIfAborted();
        return { ...session, plan };
    }
    catch (error) {
        try {
            await session.dispose();
        }
        catch (disposeError) {
            throw new AggregateError([error, disposeError], "Solve initialization and knowledge cleanup failed.");
        }
        throw error;
    }
}

function buildPlainTextProblem(problemInput: string): ProblemSpec {
    return {
        raw: problemInput,
        problemText: problemInput,
        metadata: {
            format: "plain-text"
        }
    };
}

function trimTrailingNewlines(value: string) {
    return value.replace(/\n+$/u, "");
}

export function parseProblemInput(problemInput: string): ProblemSpec {
    const structuredMatch = problemInput.match(/^expected_output:\s*\n([\s\S]*?)\n---\n([\s\S]+)$/u);
    if (!structuredMatch) {
        return buildPlainTextProblem(problemInput);
    }
    const expectedOutput = trimTrailingNewlines(structuredMatch[1]);
    const problemText = structuredMatch[2].trim();
    if (!expectedOutput || !problemText) {
        return buildPlainTextProblem(problemInput);
    }
    return {
        raw: problemInput,
        problemText,
        expectedOutput,
        metadata: {
            format: "plain-text+expected-output"
        }
    };
}

export async function createExecutionPlan(session: InitializingSolveSession): Promise<ExecutionPlan> {
    const plannerProvider = session.plannerProvider ?? llmPlanner;
    if (!plannerProvider || typeof plannerProvider.buildPlan !== "function") {
        throw new Error("LLM planner provider is required.");
    }
    const rawPlan = await plannerProvider.buildPlan(session);
    return normalizePlannerResult(rawPlan, session, {
        provider: plannerProvider.name ?? "llm",
        attemptedProvider: plannerProvider.name ?? "llm",
        promptVersion: readPlannerProperty(rawPlan, "promptVersion") ?? null,
        prompt: readPlannerProperty(rawPlan, "prompt") ?? null,
        rawResponse: readPlannerProperty(rawPlan, "rawResponse") ?? null
    });
}

function buildWorkerTask(index: number, variants: PlanVariant[], session: InitializingSolveSession): WorkerTask {
    const assignedVariant = variants[index % variants.length];
    return {
        workerId: `worker-${index + 1}`,
        strategy: assignedVariant.label,
        strategyProfile: {
            name: assignedVariant.label,
            focus: assignedVariant.approach,
            retryHint: assignedVariant.explorationHint,
            rubricFocus: assignedVariant.toolBias
        },
        assignedVariant,
        maxAttempts: session.maxIterations
    };
}

export function normalizePlannerResult(rawPlan: unknown, session: InitializingSolveSession, plannerMeta: { provider: string; attemptedProvider?: string | null; promptVersion?: unknown; prompt?: unknown; rawResponse?: unknown }): ExecutionPlan {
    const source = isRecord(rawPlan) &&
        rawPlan.plan &&
        typeof rawPlan.plan === "object"
        ? rawPlan.plan
        : rawPlan;
    const parsed = plannerResultSchema.parse(source);
    const workerCount = Math.max(2, session.parallelism ?? 4);
    return {
        mode: session.mode ?? "single",
        parallelism: workerCount,
        variants: parsed.variants,
        workerTasks: Array.from({ length: workerCount }, (_, index) => buildWorkerTask(index, parsed.variants, session)),
        planner: {
            provider: plannerMeta.provider,
            attemptedProvider: plannerMeta.attemptedProvider ?? plannerMeta.provider,
            fallbackReason: null,
            promptVersion: plannerMeta.promptVersion ?? null,
            prompt: plannerMeta.prompt ?? null,
            rawResponse: plannerMeta.rawResponse ?? null
        }
    };
}

