import fs from "node:fs/promises";
import path from "node:path";

export function sanitizeKnowledgeModelForPath(model) {
  return String(model ?? "")
    .trim()
    .replace(/\//g, ".")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function defaultKnowledgeVectorsPath(datasetPath, model) {
  const basePath = datasetPath.endsWith(".jsonl")
    ? datasetPath.replace(/\.jsonl$/, "")
    : datasetPath;
  return `${basePath}.vectors.json`;
}

export async function writeKnowledgeVectorFile(vectorsPath, vectorFile) {
  await fs.mkdir(path.dirname(vectorsPath), { recursive: true });
  await fs.writeFile(vectorsPath, `${JSON.stringify(vectorFile, null, 2)}\n`, "utf8");
}

export async function loadKnowledgeVectorFile(vectorsPath) {
  return JSON.parse(await fs.readFile(vectorsPath, "utf8"));
}

export async function loadKnowledgeVectorFileIfExists(vectorsPath) {
  try {
    return await loadKnowledgeVectorFile(vectorsPath);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

export function attachKnowledgeVectors(records, vectorFile) {
  if (!vectorFile?.items?.length) return records;
  const vectorsById = new Map(vectorFile.items.map((item) => [item.id, item.vector]));
  return records.map((record) => {
    const vector = vectorsById.get(record.id);
    return vector ? { ...record, vector } : record;
  });
}
