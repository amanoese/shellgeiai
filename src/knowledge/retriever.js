import { awaitWithSignal } from "../shared.js";
import { formatKnowledgeRecords } from "./hints.js";
import { formatEmbeddingQuery } from "./embeddingInputs.js";

/** Query embeddings are cached only in this runtime; persisted vectors remain in SQLite. */
export function createKnowledgeRetriever({ store, generationId, embedder, signal } = {}) {
  const queries = new Map();
  async function searchRecords({ query, topK = 5, maxPerCommand = 2 }) {
    if (typeof query !== "string" || !query.trim()) throw new Error("Knowledge search query must not be blank.");
    if (!Number.isSafeInteger(topK) || !Number.isSafeInteger(maxPerCommand)) throw new Error("Knowledge search limits must be integers.");
    if (topK <= 0 || maxPerCommand <= 0) return [];
    signal?.throwIfAborted();
    const formatted = formatEmbeddingQuery(query);
    if (!queries.has(formatted)) {
      const promise = awaitWithSignal(() => embedder.embed(formatted, { signal }), signal);
      queries.set(formatted, promise);
      promise.catch(() => { if (queries.get(formatted) === promise) queries.delete(formatted); });
    }
    const vector = await awaitWithSignal(() => queries.get(formatted), signal);
    signal?.throwIfAborted();
    return store.search({ generationId, vector, topK, maxPerCommand });
  }
  return {
    searchRecords,
    async retrieveForPlanner({ problem, expectedOutput }) {
      const query = [problem, expectedOutput ? `期待する出力: ${expectedOutput}` : ""].filter(Boolean).join("\n");
      return formatKnowledgeRecords(await searchRecords({ query, topK: 5, maxPerCommand: 1 }));
    },
    async search({ query }) {
      return formatKnowledgeRecords(await searchRecords({ query, topK: 5, maxPerCommand: 2 }));
    }
  };
}
