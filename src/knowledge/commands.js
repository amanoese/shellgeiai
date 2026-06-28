import { loadKnowledgeDataset } from "./dataset.js";
import { createRuriEmbedder } from "./ruriEmbedder.js";
import { writeKnowledgeVectorFile } from "./vectorFile.js";

export const DEFAULT_KNOWLEDGE_MODEL = "Xenova/multilingual-e5-small";
export const DEFAULT_KNOWLEDGE_DATASET = "data/knowledge/shellgei-basic.jsonl";
export const DEFAULT_KNOWLEDGE_VECTORS = "data/knowledge/shellgei-basic.vectors.json";

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
  vectorsPath = DEFAULT_KNOWLEDGE_VECTORS,
  embedder,
  model = DEFAULT_KNOWLEDGE_MODEL,
  now = () => new Date().toISOString()
} = {}) {
  const activeEmbedder = embedder ?? createRuriEmbedder({ model });
  await prepareKnowledgeModel({ embedder: activeEmbedder, model });
  const records = await loadKnowledgeDataset(datasetPath);
  const items = [];
  for (const record of records) {
    items.push({
      id: record.id,
      vector: await activeEmbedder.embed(`検索文書: ${record.text}`)
    });
  }
  await writeKnowledgeVectorFile(vectorsPath, {
    version: 1,
    model,
    dataset: datasetPath,
    createdAt: now(),
    items
  });
  return { datasetPath, itemCount: items.length, model, vectorsPath };
}
