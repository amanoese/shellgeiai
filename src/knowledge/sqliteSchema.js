export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const MAX_VECTOR_DIMENSIONS = 8192;

/** Recovery guidance is attached only to diagnosed persisted-database failures. */
export function knowledgeDatabaseError(message, recovery) {
  return Object.assign(new Error(message), { knowledgeRecovery: recovery });
}

export function validateDimensions(dimensions) {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > MAX_VECTOR_DIMENSIONS) {
    throw new Error(`Embedding dimensions must be an integer from 1 to ${MAX_VECTOR_DIMENSIONS}.`);
  }
}

export function createKnowledgeSchema(db, dimensions) {
  validateDimensions(dimensions);
  // Only the validated integer dimension enters SQL; all user values are bound.
  db.exec(`
    CREATE TABLE knowledge_manifest (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_profile TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK (dimensions > 0),
      dataset_path TEXT NOT NULL,
      active_generation INTEGER
    );
    CREATE TABLE knowledge_generations (
      generation_id INTEGER PRIMARY KEY,
      dataset_fingerprint TEXT NOT NULL,
      expected_count INTEGER NOT NULL CHECK (expected_count >= 0),
      status TEXT NOT NULL CHECK (status IN ('building', 'ready', 'failed')),
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE knowledge_records (
      record_rowid INTEGER PRIMARY KEY,
      generation_id INTEGER NOT NULL REFERENCES knowledge_generations(generation_id),
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      command TEXT NOT NULL,
      option TEXT NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      UNIQUE (generation_id, id)
    );
    CREATE INDEX knowledge_records_generation ON knowledge_records(generation_id);
    CREATE VIRTUAL TABLE knowledge_vectors USING vec0(
      record_rowid INTEGER PRIMARY KEY,
      embedding FLOAT[${dimensions}] distance_metric=cosine,
      generation_id INTEGER
    );
    PRAGMA user_version = ${KNOWLEDGE_SCHEMA_VERSION};
  `);
}

export function validateKnowledgeSchema(db) {
  const version = db.pragma("user_version", { simple: true });
  if (version !== KNOWLEDGE_SCHEMA_VERSION) {
    throw knowledgeDatabaseError(`Unsupported knowledge SQLite schema version ${version}; rebuild the knowledge database.`, "fresh");
  }
  const expectedColumns = {
    knowledge_manifest: ["singleton", "provider", "model", "input_profile", "dimensions", "dataset_path", "active_generation"],
    knowledge_generations: ["generation_id", "dataset_fingerprint", "expected_count", "status", "created_at", "completed_at"],
    knowledge_records: ["record_rowid", "generation_id", "id", "kind", "command", "option", "text", "source"],
    knowledge_vectors: ["record_rowid", "embedding", "generation_id"]
  };
  for (const [table, columns] of Object.entries(expectedColumns)) {
    const actual = db.pragma(`table_info(${table})`).map(column => column.name);
    if (actual.length !== columns.length || columns.some((column, index) => actual[index] !== column)) {
      throw knowledgeDatabaseError(`Incompatible knowledge SQLite schema (${table}); rebuild the knowledge database.`, "fresh");
    }
  }
  const manifest = db.prepare("SELECT * FROM knowledge_manifest WHERE singleton = 1").get();
  if (!manifest) {
    throw knowledgeDatabaseError("Knowledge SQLite schema has no identity manifest; rebuild the knowledge database.", "fresh");
  }
  try { validateDimensions(manifest.dimensions); }
  catch (cause) { throw knowledgeDatabaseError(cause.message, "fresh"); }
  const vectorSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'knowledge_vectors'").get()?.sql ?? "";
  if (!new RegExp(`USING\\s+vec0\\s*\\([\\s\\S]*embedding\\s+FLOAT\\[${manifest.dimensions}\\]\\s+distance_metric=cosine`, "i").test(vectorSql)) {
    throw knowledgeDatabaseError("Knowledge SQLite vector schema dimensions or metric mismatch; rebuild the knowledge database.", "fresh");
  }
}
