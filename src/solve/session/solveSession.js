import path from "node:path";
import { parseProblemInput } from "../../io/problem/parseProblem.js";
import { loadKnowledgeDatasetWithFingerprint } from "../../knowledge/dataset.js";
import { DEFAULT_KNOWLEDGE_MODEL } from "../../knowledge/modelConfig.js";
import {
  normalizeKnowledgeMode,
  usesPlannerKnowledge,
  usesWorkerKnowledge
} from "../../knowledge/mode.js";
import { createKnowledgeRetriever } from "../../knowledge/retriever.js";
import { createRuriEmbedder } from "../../knowledge/ruriEmbedder.js";
import { createSearchKnowledgeTool } from "../../knowledge/searchKnowledgeTool.js";
import {
  attachKnowledgeVectors,
  assertKnowledgeVectorFileCompatibility,
  defaultKnowledgeVectorsPath,
  loadKnowledgeVectorFileIfExists
} from "../../knowledge/vectorFile.js";
import { createDefaultRunnerLimits } from "../../execution/runner/limits.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../../execution/safety/policyLoader.js";
import { ensureDirectory, resolveRequestedWorkdir } from "../../shared/fs.js";
import { createExecutionPlan } from "../planning/planner.js";
import { createToolRegistry } from "../../tools/toolRegistry.js";
import { reportSessionPhase } from "./progress.js";

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
  const logsDir = path.join(process.cwd(), "logs");
  await ensureDirectory(logsDir);
  const commandPolicy = options.commandPolicy ?? (await loadCommandPolicy(options.commandPolicyPath));
  const sandboxPolicy = options.sandboxPolicy ?? (await loadSandboxPolicy(options.sandboxPolicyPath));
  const parallelism = Math.max(2, options.parallelism ?? 4);
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
    knowledgeDatasetPath: options.knowledgeDatasetPath ?? "data/knowledge/shellgei-basic.jsonl",
    knowledgeVectorsPath:
      options.knowledgeVectorsPath ??
      defaultKnowledgeVectorsPath(
        options.knowledgeDatasetPath ?? "data/knowledge/shellgei-basic.jsonl",
        options.knowledgeModel ?? DEFAULT_KNOWLEDGE_MODEL
      ),
    timeBudgetMs: options.timeBudgetMs,
    deadlineAtMs: options.timeBudgetMs == null ? null : Date.now() + options.timeBudgetMs,
    runnerLimits: options.runnerLimits ?? createDefaultRunnerLimits(),
    writableWorkdir: options.writableWorkdir ?? false,
    commandPolicy,
    sandboxPolicy,
    onProgress: options.onProgress,
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

  if (options.knowledgeRetriever) {
    session.knowledgeRetriever = options.knowledgeRetriever;
  } else if (
    usesPlannerKnowledge(session.knowledgeMode) ||
    usesWorkerKnowledge(session.knowledgeMode)
  ) {
    const { records, fingerprint: datasetFingerprint } =
      await loadKnowledgeDatasetWithFingerprint(session.knowledgeDatasetPath);
    const vectorFile = await loadKnowledgeVectorFileIfExists(session.knowledgeVectorsPath);
    if (vectorFile) {
      assertKnowledgeVectorFileCompatibility(vectorFile, {
        datasetPath: session.knowledgeDatasetPath,
        datasetFingerprint,
        model: session.knowledgeModel
      });
    }
    const recordsWithVectors = attachKnowledgeVectors(records, vectorFile);
    session.knowledgeRetriever = createKnowledgeRetriever({
      records: recordsWithVectors,
      embedder:
        options.knowledgeEmbedder ??
        (options.knowledgeEmbedderFactory ?? createRuriEmbedder)({
          model: session.knowledgeModel
        })
    });
  }

  if (usesWorkerKnowledge(session.knowledgeMode)) {
    session.toolRegistry = createToolRegistry();
    session.toolRegistry.register(
      createSearchKnowledgeTool({ retriever: session.knowledgeRetriever })
    );
  }

  session.plannerKnowledgeHints = usesPlannerKnowledge(session.knowledgeMode)
    ? await session.knowledgeRetriever.retrieveForPlanner({
        problem: session.problem.problemText,
        expectedOutput: session.problem.expectedOutput
      })
    : [];

  reportSessionPhase(session, "planning", "Building execution plan.");
  const plan = {
    ...(await createExecutionPlan(session)),
    knowledgeMode: session.knowledgeMode
  };

  return { ...session, plan };
}
