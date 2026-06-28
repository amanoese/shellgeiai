import path from "node:path";
import { parseProblemInput } from "../../io/problem/parseProblem.js";
import { loadKnowledgeDataset } from "../../knowledge/dataset.js";
import { DEFAULT_KNOWLEDGE_MODEL } from "../../knowledge/modelConfig.js";
import { createKnowledgeRetriever } from "../../knowledge/retriever.js";
import { createRuriEmbedder } from "../../knowledge/ruriEmbedder.js";
import {
  attachKnowledgeVectors,
  defaultKnowledgeVectorsPath,
  loadKnowledgeVectorFileIfExists
} from "../../knowledge/vectorFile.js";
import { createDefaultRunnerLimits } from "../../execution/runner/limits.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../../execution/safety/policyLoader.js";
import { ensureDirectory, resolveRequestedWorkdir } from "../../shared/fs.js";
import { createExecutionPlan } from "../planning/planner.js";
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
    knowledgeMode: options.knowledgeMode ?? "off",
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

  if (options.knowledgeRetriever) {
    session.knowledgeRetriever = options.knowledgeRetriever;
  } else if (session.knowledgeMode === "worker") {
    const records = await loadKnowledgeDataset(session.knowledgeDatasetPath);
    const vectorFile = await loadKnowledgeVectorFileIfExists(session.knowledgeVectorsPath);
    const recordsWithVectors = attachKnowledgeVectors(records, vectorFile);
    session.knowledgeRetriever = createKnowledgeRetriever({
      mode: session.knowledgeMode,
      records: recordsWithVectors,
      embedder:
        options.knowledgeEmbedder ??
        (options.knowledgeEmbedderFactory ?? createRuriEmbedder)({
          model: session.knowledgeModel
        }),
      topK: 10
    });
  }

  reportSessionPhase(session, "planning", "Building execution plan.");
  const plan = {
    ...(await enrichWorkerTasksWithKnowledge(session, await createExecutionPlan(session))),
    knowledgeMode: session.knowledgeMode
  };

  return { ...session, plan };
}

async function enrichWorkerTasksWithKnowledge(session, plan) {
  if (session.knowledgeMode !== "worker") return plan;

  const retriever = session.knowledgeRetriever;
  if (!retriever) return plan;

  const workerTasks = await Promise.all(
    plan.workerTasks.map(async (task) => ({
      ...task,
      knowledgeHints: await retriever.retrieveForWorker({
        problem: session.problem.problemText,
        task
      })
    }))
  );

  return { ...plan, workerTasks };
}
