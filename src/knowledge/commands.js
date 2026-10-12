import path from "node:path";
import { stat } from "node:fs/promises";
import { loadKnowledgeDatasetWithFingerprint, MAX_EMBEDDING_INPUT_BYTES } from "./dataset.js";
import { DEFAULT_KNOWLEDGE_MODEL } from "./modelConfig.js";
import { DEFAULT_KNOWLEDGE_DATASET, resolveKnowledgeDbPath } from "./knowledgePaths.js";
import { EMBEDDING_INPUT_PROFILE, formatEmbeddingDocument, formatEmbeddingQuery } from "./embeddingInputs.js";
import { createOpenRouterEmbedder } from "../providers/embedder.js";
import { assertKnowledgeModel, createKnowledgeRuntime } from "./knowledgeRuntime.js";
import { awaitWithSignal } from "../shared.js";
import { validateDimensions } from "./sqliteSchema.js";

export { DEFAULT_KNOWLEDGE_DATASET, DEFAULT_KNOWLEDGE_MODEL };

function validateVectors(vectors, count, expectedDimensions) {
  if (!Array.isArray(vectors) || vectors.length !== count) throw new Error("Embedding batch result count mismatch.");
  const dimensions = expectedDimensions ?? vectors[0]?.length;
  validateDimensions(dimensions);
  for (const vector of vectors) {
    if ((!Array.isArray(vector) && !(vector instanceof Float32Array)) || vector.length !== dimensions) {
      throw new Error("Embedding vector dimensions mismatch.");
    }
    let norm = 0;
    for (const value of vector) {
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
        throw new Error("Embedding vector must contain finite float32 numbers.");
      }
      norm = Math.fround(norm + Math.fround(Math.fround(value) ** 2));
    }
    if (norm === 0 || !Number.isFinite(norm)) throw new Error("Embedding vector must have a finite nonzero float32 norm.");
  }
  return dimensions;
}

function splitBatches(records, batchSize) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const record of records) {
    const inputBytes = Buffer.byteLength(formatEmbeddingDocument(record), "utf8");
    if (current.length && (current.length === batchSize || bytes + inputBytes > MAX_EMBEDDING_INPUT_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(record);
    bytes += inputBytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function prepareKnowledgeModel({ embedder, model = DEFAULT_KNOWLEDGE_MODEL, signal } = {}) {
  assertKnowledgeModel(model);
  const { openKnowledgeStore } = await import("./sqliteStore.js");
  const store = openKnowledgeStore({ dbPath: ":memory:" });
  try {
    const activeEmbedder = embedder ?? createOpenRouterEmbedder({ model });
    const vector = await awaitWithSignal(() => activeEmbedder.embed(formatEmbeddingQuery("warmup"), { signal }), signal);
    const dimensions = validateVectors([vector], 1);
    return { model, dimensions, provider: "openrouter", prepared: true };
  } finally {
    store.close();
  }
}

export async function buildKnowledgeVectors({
  datasetPath = DEFAULT_KNOWLEDGE_DATASET, dbPath, embedder, model = DEFAULT_KNOWLEDGE_MODEL,
  now = () => new Date().toISOString(), batchSize = 16, force = false, signal
} = {}) {
  assertKnowledgeModel(model);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 64) throw new Error("Embedding batch size must be an integer from 1 to 64.");
  datasetPath = path.resolve(datasetPath);
  dbPath = path.resolve(resolveKnowledgeDbPath({ dbPath, datasetPath, model }));
  signal?.throwIfAborted();
  const { records, fingerprint: datasetFingerprint } = await loadKnowledgeDatasetWithFingerprint(datasetPath);
  const { openKnowledgeStore } = await import("./sqliteStore.js");
  let exists = false;
  try { await stat(dbPath); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  let dimensions;
  if (exists) {
    const reader = openKnowledgeStore({ dbPath, readonly: true });
    try {
      const state = reader.inspect();
      for (const [key, value] of Object.entries({ provider: "openrouter", model, inputProfile: EMBEDDING_INPUT_PROFILE, datasetPath })) {
        if (!state.identity || state.identity[key] !== value) throw new Error(`Knowledge database ${key} mismatch; choose another --db path for this embedding identity.`);
      }
      dimensions = state.identity.dimensions;
      if (!force && state.active?.datasetFingerprint === datasetFingerprint) {
        const active = reader.assertCompatible({ datasetPath, datasetFingerprint, model, inputProfile: EMBEDDING_INPUT_PROFILE });
        return { datasetPath, dbPath, model, ...active, reused: true };
      }
    } finally { reader.close(); }
  }
  const createdAt = now();
  if (typeof createdAt !== "string" || !createdAt.trim() || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error("Build creation time must be a valid timestamp string.");
  }
  const activeEmbedder = embedder ?? createOpenRouterEmbedder({ model });
  const batches = splitBatches(records, batchSize);
  const embedBatch = async batch => {
    const inputs = batch.map(formatEmbeddingDocument);
    const vectors = await awaitWithSignal(() => activeEmbedder.embedBatch
      ? activeEmbedder.embedBatch(inputs, { signal })
      : Promise.all(inputs.map(text => activeEmbedder.embed(text, { signal }))), signal);
    dimensions = validateVectors(vectors, batch.length, dimensions);
    return vectors;
  };
  // Discover dimensions before creating a new file, so failed requests leave no invalid empty SQLite file.
  const firstVectors = exists ? null : await embedBatch(batches[0]);
  signal?.throwIfAborted();
  const store = openKnowledgeStore({ dbPath });
  let build;
  let published = false;
  try {
    build = store.beginBuild({
      identity: { provider: "openrouter", model, inputProfile: EMBEDDING_INPUT_PROFILE, dimensions, datasetPath },
      datasetFingerprint, itemCount: records.length, createdAt
    });
    for (let index = 0; index < batches.length; index++) {
      const vectors = index === 0 && firstVectors ? firstVectors : await embedBatch(batches[index]);
      signal?.throwIfAborted();
      store.appendBatch({ generationId: build.generationId, records: batches[index], vectors });
    }
    const current = await loadKnowledgeDatasetWithFingerprint(datasetPath);
    if (current.fingerprint !== datasetFingerprint) throw new Error("Knowledge dataset changed during build; rebuild from the current dataset.");
    signal?.throwIfAborted();
    store.publishBuild(build);
    published = true;
    return { datasetPath, dbPath, model, itemCount: records.length, dimensions, generationId: build.generationId, reused: false };
  } catch (error) {
    if (build && !published) {
      try { store.abortBuild(build); }
      catch (abortError) { throw new AggregateError([error, abortError], "Unable to build knowledge database and abort the staged generation."); }
    }
    throw error;
  } finally { store.close(); }
}

export async function searchKnowledge({
  query, datasetPath = DEFAULT_KNOWLEDGE_DATASET, dbPath, embedder, model = DEFAULT_KNOWLEDGE_MODEL, topK = 10, signal
} = {}) {
  assertKnowledgeModel(model);
  if (typeof query !== "string" || !query.trim()) throw new Error("Knowledge search query must not be blank.");
  if (!Number.isSafeInteger(topK)) throw new Error("Knowledge search topK must be an integer.");
  datasetPath = path.resolve(datasetPath);
  dbPath = path.resolve(resolveKnowledgeDbPath({ dbPath, datasetPath, model }));
  if (topK <= 0) return { datasetPath, dbPath, model, query, results: [] };
  const runtime = await createKnowledgeRuntime({ datasetPath, dbPath, model, embedder, signal });
  try {
    const results = await runtime.search({ query, topK, maxPerCommand: topK });
    return { datasetPath, dbPath, model, query, results };
  } finally { await runtime.dispose(); }
}
