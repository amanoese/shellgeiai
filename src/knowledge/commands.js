import { loadKnowledgeDataset } from "./dataset.js";
import { DEFAULT_KNOWLEDGE_MODEL } from "./modelConfig.js";
import { createRuriEmbedder } from "./ruriEmbedder.js";
import { searchKnowledgeRecords } from "./vectorSearch.js";
import {
  attachKnowledgeVectors,
  defaultKnowledgeVectorsPath,
  loadKnowledgeVectorFileIfExists,
  openKnowledgeVectorFileWriter
} from "./vectorFile.js";

export const DEFAULT_KNOWLEDGE_DATASET = "data/knowledge/shellgei-basic.jsonl";
export const DEFAULT_KNOWLEDGE_VECTORS = defaultKnowledgeVectorsPath(
  DEFAULT_KNOWLEDGE_DATASET,
  DEFAULT_KNOWLEDGE_MODEL
);
export { DEFAULT_KNOWLEDGE_MODEL };

export async function prepareKnowledgeModel({
  embedder,
  model = DEFAULT_KNOWLEDGE_MODEL
} = {}) {
  const activeEmbedder = embedder ?? createRuriEmbedder({ model });
  await activeEmbedder.embed("検索クエリ: warmup");
  return { model, warmedUp: true };
}

export async function buildKnowledgeVectors({
  datasetPath = DEFAULT_KNOWLEDGE_DATASET,
  vectorsPath,
  embedder,
  model = DEFAULT_KNOWLEDGE_MODEL,
  now = () => new Date().toISOString(),
  openVectorWriter = openKnowledgeVectorFileWriter
} = {}) {
  const resolvedVectorsPath =
    vectorsPath ?? defaultKnowledgeVectorsPath(datasetPath, model);
  const activeEmbedder = embedder ?? createRuriEmbedder({ model });
  await prepareKnowledgeModel({ embedder: activeEmbedder, model });
  const records = await loadKnowledgeDataset(datasetPath);
  const writer = await openVectorWriter(resolvedVectorsPath, {
    version: 2,
    itemCount: records.length,
    model,
    dataset: datasetPath,
    createdAt: now()
  });

  try {
    for (const record of records) {
      await writer.writeItem({
        id: record.id,
        vector: await activeEmbedder.embed(`検索文書: ${record.text}`)
      });
    }
    await writer.commit();
  } catch (error) {
    try {
      await writer.abort();
    } catch (abortError) {
      throw new AggregateError([error, abortError], "Unable to build knowledge vector file.");
    }
    throw error;
  }

  return {
    datasetPath,
    itemCount: records.length,
    model,
    vectorsPath: resolvedVectorsPath
  };
}

export async function searchKnowledge({
  query,
  datasetPath = DEFAULT_KNOWLEDGE_DATASET,
  vectorsPath,
  embedder,
  model = DEFAULT_KNOWLEDGE_MODEL,
  topK = 10
} = {}) {
  const resolvedVectorsPath =
    vectorsPath ?? defaultKnowledgeVectorsPath(datasetPath, model);
  const activeEmbedder = embedder ?? createRuriEmbedder({ model });
  const records = await loadKnowledgeDataset(datasetPath);
  const vectorFile = await loadKnowledgeVectorFileIfExists(resolvedVectorsPath);
  const recordsWithVectors = attachKnowledgeVectors(records, vectorFile);
  const results = await searchKnowledgeRecords({
    query: `検索クエリ: ${query}`,
    records: recordsWithVectors,
    embedder: activeEmbedder,
    topK,
    maxPerCommand: topK
  });

  return { datasetPath, model, query, results, vectorsPath: resolvedVectorsPath };
}
