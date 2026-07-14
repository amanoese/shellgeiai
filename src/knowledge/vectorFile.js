import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { DEFAULT_KNOWLEDGE_MODEL } from "./modelConfig.js";

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
  if (model && model !== DEFAULT_KNOWLEDGE_MODEL) {
    return `${basePath}.vectors.${sanitizeKnowledgeModelForPath(model)}.jsonl`;
  }
  return `${basePath}.vectors.jsonl`;
}

export function assertKnowledgeVectorFileCompatibility(
  vectorFile,
  { datasetPath, model }
) {
  const activeDataset = path.resolve(datasetPath);
  const vectorDataset =
    typeof vectorFile?.dataset === "string" && vectorFile.dataset.trim()
      ? path.resolve(vectorFile.dataset)
      : null;

  if (vectorFile?.model === model && vectorDataset === activeDataset) {
    return;
  }

  throw new Error(
    "Knowledge vector file is incompatible with the active model or dataset. " +
      `Rebuild it with \`shellgeiai knowledge build --dataset ${datasetPath} --knowledge-model ${model}\`.`
  );
}

export async function writeKnowledgeVectorFile(vectorsPath, vectorFile) {
  const items = vectorFile.items ?? [];
  const writer = await openKnowledgeVectorFileWriter(vectorsPath, {
    version: vectorFile.version ?? 2,
    itemCount: items.length,
    model: vectorFile.model,
    dataset: vectorFile.dataset,
    createdAt: vectorFile.createdAt
  });

  try {
    for (const item of items) await writer.writeItem(item);
    await writer.commit();
  } catch (error) {
    try {
      await writer.abort();
    } catch (abortError) {
      throw new AggregateError([error, abortError], "Unable to publish knowledge vector file.");
    }
    throw error;
  }
}

export async function openKnowledgeVectorFileWriter(vectorsPath, metadata) {
  const version = metadata.version ?? 2;
  if (version !== 2) {
    throw new Error(`Cannot write knowledge vector file version ${version}; expected version 2.`);
  }
  if (!Number.isInteger(metadata.itemCount) || metadata.itemCount < 0) {
    throw new Error("Cannot write knowledge vector file: itemCount must be a nonnegative integer.");
  }

  const directory = path.dirname(vectorsPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(vectorsPath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await fs.mkdir(directory, { recursive: true });

  let handle;
  try {
    handle = await fs.open(temporaryPath, "wx");
    await handle.write(
      `${JSON.stringify({
        type: "metadata",
        version,
        itemCount: metadata.itemCount,
        model: metadata.model,
        dataset: metadata.dataset,
        createdAt: metadata.createdAt
      })}\n`,
      undefined,
      "utf8"
    );
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the metadata failure while still attempting temp cleanup.
      }
    }
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  let handleOpen = true;
  let settled = false;
  let writtenItems = 0;
  let vectorDimension = null;

  async function closeHandle() {
    if (!handleOpen) return;
    await handle.close();
    handleOpen = false;
  }

  return {
    async writeItem(item) {
      if (settled || !handleOpen) {
        throw new Error("Knowledge vector writer is no longer writable.");
      }
      const normalizedItem = validateItemShape(item, vectorDimension, (message) =>
        new Error(`Invalid knowledge vector item: ${message}`)
      );
      await handle.write(
        `${JSON.stringify({
          type: "item",
          id: normalizedItem.id,
          vector: normalizedItem.vector
        })}\n`,
        undefined,
        "utf8"
      );
      vectorDimension ??= normalizedItem.vector.length;
      writtenItems += 1;
    },
    async commit() {
      if (settled) throw new Error("Knowledge vector writer is already settled.");
      if (writtenItems !== metadata.itemCount) {
        throw new Error(
          `Cannot commit knowledge vector file: expected ${metadata.itemCount} items, wrote ${writtenItems}.`
        );
      }
      await closeHandle();
      await fs.rename(temporaryPath, vectorsPath);
      settled = true;
    },
    async abort() {
      if (settled) return;
      let closeError;
      try {
        await closeHandle();
      } catch (error) {
        closeError = error;
      }
      await fs.rm(temporaryPath, { force: true });
      settled = true;
      if (closeError) throw closeError;
    }
  };
}

function lineError(lineNumber, message) {
  return new Error(`Invalid knowledge vector file line ${lineNumber}: ${message}`);
}

function validateItemShape(record, expectedDimension, createError) {
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw createError("item id must be a nonblank string.");
  }
  if (!Array.isArray(record.vector)) {
    throw createError("item vector must be an array.");
  }
  if (record.vector.length === 0) {
    throw createError("item vector must not be empty.");
  }
  if (record.vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw createError("item vector must contain only finite numbers.");
  }
  if (expectedDimension !== null && record.vector.length !== expectedDimension) {
    throw createError(
      `item vector dimension ${record.vector.length} does not match expected ${expectedDimension}.`
    );
  }
  return { id: record.id, vector: record.vector };
}

function validateItemRecord(record, lineNumber, expectedDimension) {
  return validateItemShape(record, expectedDimension, (message) => lineError(lineNumber, message));
}

async function loadKnowledgeVectorJsonl(vectorsPath) {
  const items = [];
  let metadata = null;
  let vectorDimension = null;
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

    if (!metadata) {
      if (record.type !== "metadata") {
        throw lineError(lineNumber, "metadata record must be first.");
      }
      if (record.version !== 2) {
        throw lineError(lineNumber, `unsupported version ${record.version}; expected version 2.`);
      }
      if (!Number.isInteger(record.itemCount) || record.itemCount < 0) {
        throw lineError(lineNumber, "itemCount must be a nonnegative integer.");
      }
      metadata = {
        version: record.version,
        itemCount: record.itemCount,
        model: record.model,
        dataset: record.dataset,
        createdAt: record.createdAt
      };
      continue;
    }

    if (record.type === "metadata") {
      throw lineError(lineNumber, "duplicate metadata record.");
    }
    if (record.type !== "item") throw lineError(lineNumber, "unknown record type.");
    const item = validateItemRecord(record, lineNumber, vectorDimension);
    vectorDimension ??= item.vector.length;
    items.push(item);
  }

  if (!metadata) {
    throw new Error("Invalid knowledge vector file: metadata record required as the first record.");
  }
  if (items.length !== metadata.itemCount) {
    throw new Error(
      `Invalid knowledge vector file after line ${lineNumber}: expected ${metadata.itemCount} item records, found ${items.length}.`
    );
  }

  return { ...metadata, items };
}

async function loadLegacyKnowledgeVectorFile(vectorsPath) {
  const content = await fs.readFile(vectorsPath, "utf8");
  let vectorFile;
  try {
    vectorFile = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid legacy knowledge vector file: ${error.message}`);
  }

  if (!vectorFile || typeof vectorFile !== "object" || vectorFile.version !== 1) {
    throw new Error("Invalid legacy knowledge vector file: expected version 1 object.");
  }
  if (!Array.isArray(vectorFile.items)) {
    throw new Error("Invalid legacy knowledge vector file: items must be an array.");
  }

  let vectorDimension = null;
  const items = vectorFile.items.map((item, index) => {
    try {
      const normalizedItem = validateItemRecord(item, index + 1, vectorDimension);
      vectorDimension ??= normalizedItem.vector.length;
      return normalizedItem;
    } catch (error) {
      throw new Error(`Invalid legacy knowledge vector file item ${index + 1}: ${error.message}`);
    }
  });

  return {
    version: 1,
    model: vectorFile.model,
    dataset: vectorFile.dataset,
    createdAt: vectorFile.createdAt,
    items
  };
}

async function readFirstNonblankLine(vectorsPath) {
  const handle = await fs.open(vectorsPath, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.alloc(4096);
  let pending = "";

  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        pending += decoder.end();
        return pending.trim() ? pending.replace(/\r$/, "") : null;
      }

      pending += decoder.write(buffer.subarray(0, bytesRead));
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = pending.slice(0, newlineIndex).replace(/\r$/, "");
        pending = pending.slice(newlineIndex + 1);
        if (line.trim()) return line;
        newlineIndex = pending.indexOf("\n");
      }
    }
  } finally {
    await handle.close();
  }
}

async function detectKnowledgeVectorFormat(vectorsPath) {
  const firstLine = await readFirstNonblankLine(vectorsPath);
  if (firstLine === null) return "jsonl";

  let firstRecord;
  try {
    firstRecord = JSON.parse(firstLine);
  } catch {
    return firstLine.trim() === "{" ? "legacy" : "jsonl";
  }

  if (firstRecord?.type === "metadata") return "jsonl";
  if (firstRecord?.version === 1 && Array.isArray(firstRecord.items)) return "legacy";
  return "jsonl";
}

export async function loadKnowledgeVectorFile(vectorsPath) {
  return (await detectKnowledgeVectorFormat(vectorsPath)) === "legacy"
    ? loadLegacyKnowledgeVectorFile(vectorsPath)
    : loadKnowledgeVectorJsonl(vectorsPath);
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
