import path from "node:path";
import { parseProblemInput } from "../../io/problem/parseProblem.js";
import { DEFAULT_KNOWLEDGE_MODEL } from "../../knowledge/modelConfig.js";
import {
  normalizeKnowledgeMode,
  usesPlannerKnowledge,
  usesWorkerKnowledge
} from "../../knowledge/mode.js";
import { createKnowledgeRuntime } from "../../knowledge/knowledgeRuntime.js";
import { awaitWithSignal } from "../../shared.js";
import { DEFAULT_KNOWLEDGE_DATASET, resolveKnowledgeDbPath } from "../../knowledge/knowledgePaths.js";
import { createSearchKnowledgeTool } from "../../knowledge/searchKnowledgeTool.js";
import { createDefaultRunnerLimits } from "../../execution/runner/limits.js";
import { normalizeReadonlyDockerDevices } from "../../execution/runner/dockerDevices.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../../execution/safety/policyLoader.js";
import { ensureDirectory, resolveRequestedWorkdir } from "../../shared.js";
import { createExecutionPlan } from "../planning/planner.js";
import { createToolRegistry } from "../tools.js";
import { reportSessionPhase } from "../events.js";
import { createLlmPlanner } from "../../providers/planner/llmPlanner.js";
import { resolveLlmConfig } from "../../providers/llm/config.js";

export async function createSolveSession(options) {
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
    throw new Error(
      "Read-only Docker devices require the Docker runner. Remove the device option or use --runner docker."
    );
  }
  const dockerDevicesReadonly =
    await normalizeReadonlyDockerDevices(requestedDockerDevices);
  const logsDir = path.join(process.cwd(), "logs");
  await ensureDirectory(logsDir);
  const commandPolicy = options.commandPolicy ?? (await loadCommandPolicy(options.commandPolicyPath));
  const sandboxPolicy = options.sandboxPolicy ?? (await loadSandboxPolicy(options.sandboxPolicyPath));
  const parallelism = Math.max(2, options.parallelism ?? 4);
  const llmConfig = options.llmConfig ?? options.engine?.llmConfig;
  const session = {
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

  if (
    usesWorkerKnowledge(session.knowledgeMode) &&
    (session.engine?.capabilities?.toolCalling !== true ||
      typeof session.engine?.generateTurn !== "function")
  ) {
    throw new Error(
      `Engine "${session.engine?.name ?? "unknown"}" does not support Tool Calling required by --knowledge ${session.knowledgeMode}. Use a Tool Calling capable engine, or select --knowledge planner/off.`
    );
  }

  if (session.plannerProvider == null) {
    session.llmConfig ??= resolveLlmConfig();
    session.plannerProvider = createLlmPlanner({
      config: session.llmConfig,
      client: options.engine?.client,
      clientFactory: options.engine?.clientFactory,
      fetchImpl: options.engine?.fetchImpl
    });
  }

  let ownedRuntime;
  let disposed = false;
  const controller = new AbortController();
  const externalAbort = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();
  const timer = session.deadlineAtMs == null ? null : setTimeout(
    () => controller.abort(new Error("Solve time budget exceeded.")),
    Math.max(0, session.deadlineAtMs - Date.now())
  );
  timer?.unref?.();
  session.signal = controller.signal;
  session.dispose = async () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
    controller.abort(new Error("Solve session disposed."));
    await ownedRuntime?.dispose();
  };

  try {
    controller.signal.throwIfAborted();
    if (options.knowledgeRetriever) {
      session.knowledgeRetriever = options.knowledgeRetriever;
    } else if (usesPlannerKnowledge(session.knowledgeMode) || usesWorkerKnowledge(session.knowledgeMode)) {
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
      session.toolRegistry.register(createSearchKnowledgeTool({ retriever: session.knowledgeRetriever }));
    }
    session.plannerKnowledgeHints = usesPlannerKnowledge(session.knowledgeMode)
      ? await awaitWithSignal(() => session.knowledgeRetriever.retrieveForPlanner({
          problem: session.problem.problemText,
          expectedOutput: session.problem.expectedOutput
        }), controller.signal)
      : [];
    controller.signal.throwIfAborted();
    reportSessionPhase(session, "planning", "Building execution plan.");
    const plan = { ...(await awaitWithSignal(() => createExecutionPlan(session), controller.signal)), knowledgeMode: session.knowledgeMode };
    controller.signal.throwIfAborted();
    return { ...session, plan };
  } catch (error) {
    try { await session.dispose(); }
    catch (disposeError) { throw new AggregateError([error, disposeError], "Solve initialization and knowledge cleanup failed."); }
    throw error;
  }
}
