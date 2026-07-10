import { randomUUID } from "node:crypto";
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
      await handle.write(
        `${JSON.stringify({ type: "item", id: item.id, vector: item.vector })}\n`,
        undefined,
        "utf8"
      );
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

function validateItemRecord(record, lineNumber) {
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw lineError(lineNumber, "item id must be a nonblank string.");
  }
  if (!Array.isArray(record.vector)) {
    throw lineError(lineNumber, "item vector must be an array.");
  }
  if (record.vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw lineError(lineNumber, "item vector must contain only finite numbers.");
  }
  return { id: record.id, vector: record.vector };
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
    items.push(validateItemRecord(record, lineNumber));
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

  const items = vectorFile.items.map((item, index) => {
    try {
      return validateItemRecord(item, index + 1);
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

export async function loadKnowledgeVectorFile(vectorsPath) {
  return vectorsPath.endsWith(".json")
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
