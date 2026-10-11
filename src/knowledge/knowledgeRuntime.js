import path from "node:path";
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
    throw new Error(`${cause.message}\nRebuild with: shellgeiai knowledge build --dataset ${shellQuote(datasetPath)} --db ${shellQuote(dbPath)} --model ${shellQuote(model)}`, { cause });
  }
}
