import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

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
  return `${basePath}.vectors.jsonl`;
}

export async function writeKnowledgeVectorFile(vectorsPath, vectorFile) {
  await fs.mkdir(path.dirname(vectorsPath), { recursive: true });
  const lines = [
    JSON.stringify({
      type: "metadata",
      version: vectorFile.version ?? 2,
      model: vectorFile.model,
      dataset: vectorFile.dataset,
      createdAt: vectorFile.createdAt
    }),
    ...(vectorFile.items ?? []).map((item) =>
      JSON.stringify({ type: "item", id: item.id, vector: item.vector })
    ),
    ""
  ];
  await fs.writeFile(vectorsPath, lines.join("\n"), "utf8");
}

export async function openKnowledgeVectorFileWriter(vectorsPath, metadata) {
  await fs.mkdir(path.dirname(vectorsPath), { recursive: true });
  const handle = await fs.open(vectorsPath, "w");
  await handle.write(
    `${JSON.stringify({
      type: "metadata",
      version: metadata.version ?? 2,
      model: metadata.model,
      dataset: metadata.dataset,
      createdAt: metadata.createdAt
    })}\n`,
    undefined,
    "utf8"
  );

  return {
    async writeItem(item) {
      await handle.write(
        `${JSON.stringify({ type: "item", id: item.id, vector: item.vector })}\n`,
        undefined,
        "utf8"
      );
    },
    async close() {
      await handle.close();
    }
  };
}

async function loadKnowledgeVectorJsonl(vectorsPath) {
  const items = [];
  let metadata = null;
  const lines = readline.createInterface({
    input: createReadStream(vectorsPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid knowledge vector file line ${lineNumber}: ${error.message}`);
    }

    if (record.type === "metadata") {
      metadata = {
        version: record.version,
        model: record.model,
        dataset: record.dataset,
        createdAt: record.createdAt
      };
    } else if (record.type === "item") {
      items.push({ id: record.id, vector: record.vector });
    } else {
      throw new Error(`Invalid knowledge vector file line ${lineNumber}: unknown record type.`);
    }
  }

  if (!metadata) {
    throw new Error("Invalid knowledge vector file: metadata record required.");
  }

  return { ...metadata, items };
}

export async function loadKnowledgeVectorFile(vectorsPath) {
  return loadKnowledgeVectorJsonl(vectorsPath);
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
