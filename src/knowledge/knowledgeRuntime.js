import path from "node:path";
import { lstat } from "node:fs/promises";
import { loadKnowledgeDatasetWithFingerprint } from "./dataset.js";
import { DEFAULT_KNOWLEDGE_MODEL } from "./modelConfig.js";
import { DEFAULT_KNOWLEDGE_DATASET, resolveKnowledgeDbPath } from "./knowledgePaths.js";
import { EMBEDDING_INPUT_PROFILE } from "./embeddingInputs.js";
import { createKnowledgeRetriever } from "./retriever.js";
import { createOpenRouterEmbedder } from "../providers/embeddings/openRouterEmbedder.js";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function assertKnowledgeModel(model) {
  if (typeof model !== "string" || !model.trim()) throw new Error("Embedding model must be a nonempty string.");
}

async function unusedRebuildPath(dbPath) {
  for (let sequence = 1; ; sequence++) {
    const candidate = `${dbPath}.rebuilt${sequence === 1 ? "" : `-${sequence}`}.sqlite`;
    try { await lstat(candidate); }
    catch (error) {
      if (error.code === "ENOENT") return candidate;
      throw error;
    }
  }
}

async function recoveryHint(cause, { datasetPath, dbPath, model }) {
  const fresh = cause.knowledgeRecovery === "fresh";
  const target = fresh ? await unusedRebuildPath(dbPath) : dbPath;
  const force = cause.knowledgeRecovery === "force" ? " --force" : "";
  const identityOptions = `--dataset ${shellQuote(datasetPath)} --model ${shellQuote(model)}`;
  const rebuild = `Rebuild with: shellgeiai knowledge build --dataset ${shellQuote(datasetPath)} --db ${shellQuote(target)} --model ${shellQuote(model)}${force}`;
  if (!fresh) return rebuild;
  return `${rebuild}\nKeep the old database. Configure subsequent commands to use the rebuilt database:\n` +
    `shellgeiai knowledge search --db ${shellQuote(target)} ${identityOptions} 'your query'\n` +
    `shellgeiai solve --knowledge-db ${shellQuote(target)} --knowledge-dataset ${shellQuote(datasetPath)} --knowledge-model ${shellQuote(model)} --knowledge planner 'your problem'`;
}

/** Owns one read-only connection and pins its active generation for the entire solve. */
export async function createKnowledgeRuntime({
  datasetPath = DEFAULT_KNOWLEDGE_DATASET, dbPath, model = DEFAULT_KNOWLEDGE_MODEL,
  embedder, embedderFactory = createOpenRouterEmbedder, signal
} = {}) {
  assertKnowledgeModel(model);
  datasetPath = path.resolve(datasetPath);
  dbPath = path.resolve(resolveKnowledgeDbPath({ dbPath, datasetPath, model }));
  signal?.throwIfAborted();
  let store;
  try {
    const { fingerprint: datasetFingerprint } = await loadKnowledgeDatasetWithFingerprint(datasetPath);
    const { openKnowledgeStore } = await import("./sqliteStore.js");
    store = openKnowledgeStore({ dbPath, readonly: true });
    const active = store.assertCompatible({ datasetPath, datasetFingerprint, model, inputProfile: EMBEDDING_INPUT_PROFILE });
    signal?.throwIfAborted();
    const retriever = createKnowledgeRetriever({ store, generationId: active.generationId,
      embedder: embedder ?? embedderFactory({ model }), signal });
    let disposed = false;
    return {
      retriever,
      search: retriever.searchRecords,
      snapshot: { provider: "openrouter", model, inputProfile: EMBEDDING_INPUT_PROFILE, dbPath,
        dimensions: active.dimensions, generationId: active.generationId, datasetFingerprint },
      async dispose() {
        if (!disposed) { disposed = true; store.close(); }
      }
    };
  } catch (cause) {
    store?.close();
    if (signal?.aborted) throw cause;
    if (!cause.knowledgeRecovery) throw cause;
    const hint = await recoveryHint(cause, { datasetPath, dbPath, model });
    throw new Error(`${cause.message}\n${hint}`, { cause });
  }
}
