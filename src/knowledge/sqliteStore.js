import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { createKnowledgeSchema, knowledgeDatabaseError, validateDimensions, validateKnowledgeSchema } from "./sqliteSchema.js";

const MAX_NATIVE_K = 4096;
const IDENTITY_KEYS = ["provider", "model", "inputProfile", "dimensions", "datasetPath"];
const RECORD_KEYS = ["id", "kind", "command", "option", "text", "source"];

function textValue(value, name, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`${name} must be ${allowEmpty ? "a string" : "a nonempty string"}.`);
  }
  return value;
}

function normalizeIdentity(identity) {
  if (!identity || identity.provider !== "openrouter") {
    throw new Error("Knowledge embedding provider must be openrouter.");
  }
  validateDimensions(identity.dimensions);
  return {
    provider: "openrouter",
    model: textValue(identity.model, "Embedding model"),
    inputProfile: textValue(identity.inputProfile, "Embedding input profile"),
    dimensions: identity.dimensions,
    datasetPath: path.resolve(textValue(identity.datasetPath, "Dataset path"))
  };
}

function manifestIdentity(manifest) {
  return {
    provider: manifest.provider, model: manifest.model, inputProfile: manifest.input_profile,
    dimensions: manifest.dimensions, datasetPath: manifest.dataset_path
  };
}

function assertIdentity(actual, expected) {
  for (const key of IDENTITY_KEYS) {
    if (actual[key] !== expected[key]) {
      throw knowledgeDatabaseError(`Knowledge database ${key} mismatch; rebuild the knowledge database for this embedding identity.`, "fresh");
    }
  }
}

function vectorBuffer(vector, dimensions) {
  if ((!Array.isArray(vector) && !(vector instanceof Float32Array)) || vector.length !== dimensions) {
    throw new Error(`Embedding vector dimensions must equal ${dimensions}.`);
  }
  const values = new Float32Array(dimensions);
  let squaredNorm = 0;
  for (let index = 0; index < dimensions; index += 1) {
    const value = vector[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Embedding vector must contain only finite numbers.");
    }
    values[index] = value;
    if (!Number.isFinite(values[index])) {
      throw new Error("Embedding vector values must remain finite in float32 representation.");
    }
    squaredNorm = Math.fround(squaredNorm + Math.fround(values[index] * values[index]));
  }
  if (squaredNorm === 0) {
    throw new Error("Embedding vector must have a nonzero float32 norm.");
  }
  if (!Number.isFinite(squaredNorm)) {
    throw new Error("Embedding vector must have a finite float32 squared norm.");
  }
  return Buffer.from(values.buffer);
}

function integerId(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function numericRowid(value) {
  const rowid = Number(value);
  return integerId(rowid, "SQLite rowid");
}

function sortHits(left, right) {
  return left.distance - right.distance || Buffer.compare(Buffer.from(left.id), Buffer.from(right.id));
}

function diversify(hits, topK, maxPerCommand) {
  const counts = new Map();
  const selected = [];
  for (const hit of hits) {
    const key = hit.command || hit.id;
    const count = counts.get(key) ?? 0;
    if (count >= maxPerCommand) continue;
    counts.set(key, count + 1);
    selected.push(hit);
    if (selected.length === topK) break;
  }
  return selected;
}

/** A synchronous local store: remote embedding calls belong outside these transactions. */
export function openKnowledgeStore({ dbPath, readonly = false }) {
  textValue(dbPath, "Knowledge database path");
  const memory = dbPath === ":memory:";
  const filename = memory ? dbPath : path.resolve(dbPath);
  const existed = !memory && fs.existsSync(filename);
  if (readonly && !existed) {
    throw knowledgeDatabaseError(`Knowledge database does not exist at ${filename}; run knowledge build first.`, "missing");
  }
  if (!readonly && !memory) fs.mkdirSync(path.dirname(filename), { recursive: true });

  let db;
  let initialized = false;
  let closed = false;
  try {
    try {
      db = new Database(filename, readonly ? { readonly: true, fileMustExist: true } : {});
      sqliteVec.load(db);
      db.prepare("SELECT vec_version() AS version").get();
    } catch (cause) {
      throw new Error(`Cannot open native SQLite/sqlite-vec knowledge store on ${process.platform}/${process.arch}. ` +
        "Reinstall better-sqlite3 and sqlite-vec for this operating system, architecture, and Node.js version. " +
        cause.message, { cause });
    }
    const version = db.pragma("user_version", { simple: true });
    if (existed || readonly || version !== 0) {
      validateKnowledgeSchema(db);
      initialized = true;
    }
    if (!readonly) {
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      db.pragma("busy_timeout = 5000");
    }
  } catch (error) {
    if (db?.open) db.close();
    throw error;
  }

  function checkOpen() {
    if (closed) throw new Error("Knowledge database is closed.");
  }
  function checkWritable() {
    checkOpen();
    if (readonly) throw new Error("Knowledge database is read-only; open a writable store to build it.");
  }
  function manifest() {
    return initialized ? db.prepare("SELECT * FROM knowledge_manifest WHERE singleton = 1").get() : null;
  }
  function generation(generationId, status) {
    integerId(generationId, "Generation id");
    const row = initialized
      ? db.prepare("SELECT * FROM knowledge_generations WHERE generation_id = ?").get(generationId) : null;
    if (!row || row.status !== status) throw knowledgeDatabaseError(`Knowledge generation ${generationId} must be ${status}.`, "fresh");
    return row;
  }
  function activeInfo(row, dimensions) {
    return { generationId: row.generation_id, datasetFingerprint: row.dataset_fingerprint,
      itemCount: row.expected_count, dimensions };
  }
  function assertGenerationIntegrity(generationId, expectedCount) {
    const recordCount = db.prepare("SELECT count(*) AS count FROM knowledge_records WHERE generation_id = ?")
      .get(generationId).count;
    const vectorCount = db.prepare("SELECT count(*) AS count FROM knowledge_vectors WHERE generation_id = ?")
      .get(generationId).count;
    const mismatched = db.prepare(`SELECT
      EXISTS (SELECT record_rowid FROM knowledge_records WHERE generation_id = ?
        EXCEPT SELECT record_rowid FROM knowledge_vectors WHERE generation_id = ?) OR
      EXISTS (SELECT record_rowid FROM knowledge_vectors WHERE generation_id = ?
        EXCEPT SELECT record_rowid FROM knowledge_records WHERE generation_id = ?) AS mismatched`)
      .get(generationId, generationId, generationId, generationId).mismatched;
    if (recordCount !== expectedCount || vectorCount !== expectedCount || mismatched) {
      throw knowledgeDatabaseError("Knowledge generation record/vector count or rowid mismatch; rebuild the knowledge database.", "force");
    }
  }

  return {
    inspect() {
      checkOpen();
      const row = manifest();
      if (!row) return { identity: null, active: null };
      return { identity: manifestIdentity(row), active: row.active_generation === null ? null
        : activeInfo(generation(row.active_generation, "ready"), row.dimensions) };
    },

    assertCompatible({ datasetPath, datasetFingerprint, model, inputProfile }) {
      const state = this.inspect();
      if (!state.identity) throw knowledgeDatabaseError("Knowledge database has no identity; rebuild the knowledge database.", "fresh");
      const expected = normalizeIdentity({ provider: "openrouter", datasetPath, model, inputProfile,
        dimensions: state.identity.dimensions });
      assertIdentity(state.identity, expected);
      if (!state.active) throw knowledgeDatabaseError("Knowledge database has no ready active generation; run knowledge build first.", "force");
      if (state.active.datasetFingerprint !== datasetFingerprint) {
        throw knowledgeDatabaseError("Knowledge dataset fingerprint mismatch; rebuild the knowledge database.", "force");
      }
      // Schema fixes every vector's dimension. Verify complete rowid sets in a
      // read snapshot without fetching or scanning the embedding payloads.
      db.transaction(() => assertGenerationIntegrity(state.active.generationId, state.active.itemCount))();
      return state.active;
    },

    beginBuild({ identity, datasetFingerprint, itemCount, createdAt = new Date().toISOString() }) {
      checkWritable();
      const normalized = normalizeIdentity(identity);
      textValue(datasetFingerprint, "Dataset fingerprint");
      textValue(createdAt, "Build creation time");
      if (!Number.isSafeInteger(itemCount) || itemCount < 0) throw new Error("Build item count must be a nonnegative integer.");
      const result = db.transaction(() => {
        if (!initialized) {
          createKnowledgeSchema(db, normalized.dimensions);
          db.prepare(`INSERT INTO knowledge_manifest
            (singleton, provider, model, input_profile, dimensions, dataset_path, active_generation)
            VALUES (1, ?, ?, ?, ?, ?, NULL)`).run(normalized.provider, normalized.model,
            normalized.inputProfile, normalized.dimensions, normalized.datasetPath);
        } else {
          assertIdentity(manifestIdentity(manifest()), normalized);
        }
        const baseGeneration = db.prepare("SELECT active_generation FROM knowledge_manifest WHERE singleton = 1").get().active_generation;
        const inserted = db.prepare(`INSERT INTO knowledge_generations
          (dataset_fingerprint, expected_count, status, created_at) VALUES (?, ?, 'building', ?)`)
          .run(datasetFingerprint, itemCount, createdAt);
        return { generationId: numericRowid(inserted.lastInsertRowid), baseGeneration };
      }).immediate();
      initialized = true;
      return result;
    },

    appendBatch({ generationId, records, vectors }) {
      checkWritable();
      generation(generationId, "building");
      if (!Array.isArray(records) || !Array.isArray(vectors) || records.length !== vectors.length) {
        throw new Error("Record and vector batch lengths must match.");
      }
      const dimensions = manifest().dimensions;
      const buffers = vectors.map(vector => vectorBuffer(vector, dimensions));
      for (const record of records) {
        if (!record || typeof record !== "object") throw new Error("Knowledge record must be an object.");
        for (const key of RECORD_KEYS) textValue(record[key], `Record ${key}`, { allowEmpty: key !== "id" });
      }
      db.transaction(() => {
        generation(generationId, "building");
        const insertRecord = db.prepare(`INSERT INTO knowledge_records
          (generation_id, id, kind, command, option, text, source) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        // better-sqlite3 binds JavaScript numbers as REAL; vec0 requires actual
        // SQLite INTEGER values for rowids and integer metadata.
        const insertVector = db.prepare("INSERT INTO knowledge_vectors (record_rowid, embedding, generation_id) VALUES (CAST(? AS INTEGER), ?, CAST(? AS INTEGER))");
        for (let index = 0; index < records.length; index += 1) {
          const record = records[index];
          const inserted = insertRecord.run(generationId, ...RECORD_KEYS.map(key => record[key]));
          insertVector.run(numericRowid(inserted.lastInsertRowid), buffers[index], generationId);
        }
      }).immediate();
    },

    publishBuild({ generationId, baseGeneration }) {
      checkWritable();
      if (baseGeneration !== null) integerId(baseGeneration, "Base generation id");
      db.transaction(() => {
        const build = generation(generationId, "building");
        const row = manifest();
        if (row.active_generation !== baseGeneration) {
          throw new Error("Active knowledge generation changed during this build; a concurrent publisher won. Rebuild and retry.");
        }
        textValue(build.dataset_fingerprint, "Dataset fingerprint");
        const recordCount = db.prepare("SELECT count(*) AS count FROM knowledge_records WHERE generation_id = ?").get(generationId).count;
        const vectorCount = db.prepare("SELECT count(*) AS count FROM knowledge_vectors WHERE generation_id = ?").get(generationId).count;
        const matchingCount = db.prepare(`SELECT count(*) AS count FROM knowledge_records AS r
          JOIN knowledge_vectors AS v ON v.record_rowid = r.record_rowid
          WHERE r.generation_id = ? AND v.generation_id = ? AND vec_length(v.embedding) = ?`)
          .get(generationId, generationId, row.dimensions).count;
        if (recordCount !== build.expected_count || vectorCount !== build.expected_count || matchingCount !== build.expected_count) {
          throw new Error("Knowledge build record/vector count or rowid mismatch; the generation cannot be published.");
        }
        db.prepare("UPDATE knowledge_generations SET status = 'ready', completed_at = ? WHERE generation_id = ?")
          .run(new Date().toISOString(), generationId);
        db.prepare("UPDATE knowledge_manifest SET active_generation = ? WHERE singleton = 1").run(generationId);
      }).immediate();
    },

    abortBuild({ generationId }) {
      checkWritable();
      db.transaction(() => {
        generation(generationId, "building");
        // Metadata ownership includes orphan vectors from an incomplete or
        // damaged build; do not touch vectors belonging to ready generations.
        const rows = db.prepare("SELECT record_rowid FROM knowledge_vectors WHERE generation_id = ?").all(generationId);
        const deleteVector = db.prepare("DELETE FROM knowledge_vectors WHERE record_rowid = ?");
        for (const row of rows) deleteVector.run(row.record_rowid);
        db.prepare("DELETE FROM knowledge_records WHERE generation_id = ?").run(generationId);
        db.prepare("UPDATE knowledge_generations SET status = 'failed', completed_at = ? WHERE generation_id = ?")
          .run(new Date().toISOString(), generationId);
      }).immediate();
    },

    search({ generationId, vector, topK = 10, maxPerCommand = 2 }) {
      checkOpen();
      const ready = generation(generationId, "ready");
      const query = vectorBuffer(vector, manifest().dimensions);
      if (!Number.isSafeInteger(topK) || !Number.isSafeInteger(maxPerCommand)) {
        throw new Error("Knowledge search limits must be integers.");
      }
      if (topK <= 0 || maxPerCommand <= 0 || ready.expected_count === 0) return [];
      // sqlite-vec 0.1.9 limits native k to 4096. Disjoint rowid groups retain
      // native KNN for large datasets; merging local top-k gives global top-k.
      const rowids = ready.expected_count > MAX_NATIVE_K
        ? db.prepare("SELECT record_rowid FROM knowledge_records WHERE generation_id = ? ORDER BY record_rowid").all(generationId)
          .map(row => row.record_rowid) : null;
      const groups = rowids ? Array.from({ length: Math.ceil(rowids.length / MAX_NATIVE_K) }, (_, index) =>
        rowids.slice(index * MAX_NATIVE_K, (index + 1) * MAX_NATIVE_K)) : [null];
      const statements = groups.map(group => db.prepare(`SELECT r.id, r.kind, r.command, r.option, r.text, r.source, v.distance
        FROM knowledge_vectors AS v JOIN knowledge_records AS r ON r.record_rowid = v.record_rowid
        WHERE v.embedding MATCH ? AND v.generation_id = CAST(? AS INTEGER) AND k = CAST(? AS INTEGER)
        ${group ? `AND v.record_rowid IN (${group.map(() => "?").join(",")})` : ""}
        AND r.generation_id = ? ORDER BY v.distance ASC, r.id COLLATE BINARY ASC`));
      let candidateCount = Math.min(ready.expected_count, Math.max(20, topK * 4));
      while (true) {
        const candidates = groups.flatMap((group, index) => statements[index].all(query, generationId,
          Math.min(candidateCount, group?.length ?? MAX_NATIVE_K), ...(group ?? []), generationId))
          .map(hit => {
            if (typeof hit.distance !== "number" || !Number.isFinite(hit.distance)) {
              throw new Error("Knowledge vector produced an invalid native cosine distance; rebuild the knowledge database.");
            }
            return hit;
          }).sort(sortHits).slice(0, candidateCount).map(hit => ({ ...hit, score: 1 - hit.distance }));
        const selected = diversify(candidates, topK, maxPerCommand);
        if (candidateCount >= ready.expected_count || candidates.length === 0) return selected;
        const enough = selected.length >= topK;
        const tiedBoundary = enough && selected.at(-1).distance === candidates.at(-1).distance;
        if (enough && !tiedBoundary) return selected;
        candidateCount = Math.min(ready.expected_count, candidateCount * 2);
      }
    },

    close() {
      if (closed) return;
      db.close();
      closed = true;
    }
  };
}
