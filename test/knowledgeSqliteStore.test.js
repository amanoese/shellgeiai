import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { afterEach, describe, expect, it } from "vitest";
import { openKnowledgeStore } from "../dist/knowledge/store.js";

const directories = [];
const stores = [];
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shellgeiai-sqlite-"));
  directories.push(directory);
  return { directory, dbPath: path.join(directory, "nested", "knowledge.sqlite") };
}
function open(dbPath, options = {}) {
  const store = openKnowledgeStore({ dbPath, ...options });
  stores.push(store);
  return store;
}
function identity(directory, overrides = {}) {
  return {
    provider: "openrouter", model: "test/model", inputProfile: "plain-v1",
    dimensions: 2, datasetPath: path.join(directory, "dataset.jsonl"), ...overrides
  };
}
function record(id, command = id) {
  return { id, kind: "note", command, option: "", text: `Use ${id}`, source: "test" };
}
function begin(store, itemIdentity, records, fingerprint = "fingerprint") {
  return store.beginBuild({ identity: itemIdentity, datasetFingerprint: fingerprint,
    itemCount: records.length, createdAt: "2026-10-11T00:00:00.000Z" });
}
function build(store, itemIdentity, records, vectors, fingerprint = "fingerprint") {
  const generation = begin(store, itemIdentity, records, fingerprint);
  store.appendBatch({ generationId: generation.generationId, records, vectors });
  store.publishBuild(generation);
  return generation;
}
function compatible(itemIdentity, fingerprint = "fingerprint") {
  return { datasetPath: itemIdentity.datasetPath, datasetFingerprint: fingerprint,
    model: itemIdentity.model, inputProfile: itemIdentity.inputProfile };
}
function raw(dbPath) {
  const db = new Database(dbPath);
  sqliteVec.load(db);
  return db;
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("native SQLite knowledge store", () => {
  it("publishes actual cosine vectors and reopens a compatible read-only database", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    expect(store.inspect()).toEqual({ identity: null, active: null });
    const itemIdentity = identity(directory);
    const generation = build(store, itemIdentity,
      [record("same"), record("diagonal"), record("opposite")], [[1, 0], [1, 1], [-1, 0]]);
    expect(store.inspect()).toEqual({ identity: itemIdentity, active: {
      generationId: generation.generationId, datasetFingerprint: "fingerprint", itemCount: 3, dimensions: 2
    } });
    store.close();
    const reader = open(dbPath, { readonly: true });
    const active = reader.assertCompatible(compatible(itemIdentity));
    const hits = reader.search({ generationId: active.generationId, vector: [1, 0] });
    expect(hits.map(hit => hit.id)).toEqual(["same", "diagonal", "opposite"]);
    expect(hits[0]).toMatchObject({ ...record("same"), distance: 0, score: 1 });
    expect(hits[1].score).toBeCloseTo(Math.SQRT1_2, 6);
    expect(hits[2].score).toBe(-1);
    expect(reader.search({ generationId: active.generationId, vector: [1, 0], topK: 0 })).toEqual([]);
    expect(() => begin(reader, itemIdentity, [])).toThrow(/read.only/i);
    reader.close();
    reader.close();
  });

  it("supports a 4096 dimensional embedding through sqlite-vec", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const vector = Array(4096).fill(0); vector[4095] = 1;
    const generation = build(store, identity(directory, { dimensions: 4096 }), [record("large")], [vector]);
    expect(store.search({ generationId: generation.generationId, vector })[0].score).toBe(1);
  });

  it("retains the active generation after a failed build and rolls back a partial batch", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const itemIdentity = identity(directory);
    const old = build(store, itemIdentity, [record("old")], [[1, 0]], "old");
    const newer = begin(store, itemIdentity, [record("new"), record("new")], "new");
    expect(() => store.appendBatch({ generationId: newer.generationId,
      records: [record("new"), record("new")], vectors: [[0, 1], [0, 1]] })).toThrow(/unique/i);
    expect(() => store.publishBuild(newer)).toThrow(/count/i);
    store.abortBuild(newer);
    expect(store.assertCompatible(compatible(itemIdentity, "old")).generationId).toBe(old.generationId);
    expect(store.search({ generationId: old.generationId, vector: [1, 0] })[0].id).toBe("old");
    const db = raw(dbPath);
    try {
      expect(db.prepare("SELECT count(*) AS n FROM knowledge_records WHERE generation_id = ?")
        .get(newer.generationId).n).toBe(0);
      expect(db.prepare("SELECT count(*) AS n FROM knowledge_vectors WHERE generation_id = ?")
        .get(newer.generationId).n).toBe(0);
    } finally { db.close(); }
  });

  it("pins a reader to an old ready generation after another connection publishes", () => {
    const { directory, dbPath } = fixture();
    const writer = open(dbPath);
    const itemIdentity = identity(directory);
    const old = build(writer, itemIdentity, [record("old")], [[1, 0]], "old");
    const reader = open(dbPath, { readonly: true });
    const pinned = reader.assertCompatible(compatible(itemIdentity, "old"));
    const next = build(writer, itemIdentity, [record("next")], [[0, 1]], "next");
    expect(reader.search({ generationId: pinned.generationId, vector: [1, 0] })[0].id).toBe("old");
    expect(reader.inspect().active.generationId).toBe(next.generationId);
    expect(() => writer.abortBuild(old)).toThrow(/building/i);
    expect(reader.search({ generationId: old.generationId, vector: [1, 0] })[0].id).toBe("old");
  });

  it("rejects a competing publisher with a stale base generation", () => {
    const { directory, dbPath } = fixture();
    const first = open(dbPath);
    const itemIdentity = identity(directory);
    build(first, itemIdentity, [record("old")], [[1, 0]]);
    const second = open(dbPath);
    const a = begin(first, itemIdentity, [record("a")], "a");
    const b = begin(second, itemIdentity, [record("b")], "b");
    first.appendBatch({ generationId: a.generationId, records: [record("a")], vectors: [[1, 0]] });
    second.appendBatch({ generationId: b.generationId, records: [record("b")], vectors: [[0, 1]] });
    first.publishBuild(a);
    expect(() => second.publishBuild(b)).toThrow(/changed|concurrent|stale/i);
    second.abortBuild(b);
    expect(second.inspect().active.generationId).toBe(a.generationId);
  });

  it("validates identity, source freshness and generation readiness", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const itemIdentity = identity(directory);
    const pending = begin(store, itemIdentity, [record("one")]);
    expect(() => store.assertCompatible(compatible(itemIdentity))).toThrow(/ready|active/i);
    expect(() => store.search({ generationId: pending.generationId, vector: [1, 0] })).toThrow(/ready/i);
    expect(() => store.publishBuild(pending)).toThrow(/count/i);
    store.appendBatch({ generationId: pending.generationId, records: [record("one")], vectors: [[1, 0]] });
    store.publishBuild(pending);
    for (const [key, value] of Object.entries({ model: "another/model", inputProfile: "another",
      datasetPath: path.join(directory, "different.jsonl"), datasetFingerprint: "changed" })) {
      expect(() => store.assertCompatible({ ...compatible(itemIdentity), [key]: value })).toThrow(/mismatch|rebuild|incompatible/i);
    }
    expect(() => begin(store, { ...itemIdentity, dimensions: 3 }, [])).toThrow(/mismatch|incompatible/i);
    expect(() => begin(store, { ...itemIdentity, provider: "other" }, [])).toThrow(/openrouter|provider/i);
    expect(() => store.appendBatch({ generationId: pending.generationId,
      records: [record("two")], vectors: [[1, 0]] })).toThrow(/building/i);
    expect(() => store.publishBuild(pending)).toThrow(/building/i);
  });

  it.each([[], [1], [0, 0], [NaN, 0], [Infinity, 0], [1e40, 0], [1e-50, 0], [1e-30, 0], [3e38, 0]].map(vector => [vector]))(
    "rejects invalid vectors without publishing: %j", (vector) => {
      const { directory, dbPath } = fixture();
      const store = open(dbPath);
      const generation = begin(store, identity(directory), [record("one")]);
      expect(() => store.appendBatch({ generationId: generation.generationId,
        records: [record("one")], vectors: [vector] })).toThrow(/vector|dimension|finite|zero/i);
      expect(() => store.publishBuild(generation)).toThrow(/count/i);
    });

  it("validates records and matching batch lengths", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const generation = begin(store, identity(directory), [record("one")]);
    expect(() => store.appendBatch({ generationId: generation.generationId,
      records: [record("one")], vectors: [] })).toThrow(/count|length/i);
    expect(() => store.appendBatch({ generationId: generation.generationId,
      records: [{ ...record("one"), source: null }], vectors: [[1, 0]] })).toThrow(/source|record/i);
    store.appendBatch({ generationId: generation.generationId, records: [record("one")], vectors: [[1, 0]] });
    store.publishBuild(generation);
    expect(() => store.search({ generationId: generation.generationId, vector: [0, 0] })).toThrow(/zero/i);
  });

  it("refuses publication when a corresponding native vector is missing", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const generation = begin(store, identity(directory), [record("one")]);
    store.appendBatch({ generationId: generation.generationId, records: [record("one")], vectors: [[1, 0]] });
    const db = raw(dbPath);
    try { db.exec("DELETE FROM knowledge_vectors"); } finally { db.close(); }
    expect(() => store.publishBuild(generation)).toThrow(/vector|count/i);
    expect(store.inspect().active).toBeNull();
  });

  it("rejects a previously published generation whose vector set is incomplete", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const itemIdentity = identity(directory);
    build(store, itemIdentity, [record("one")], [[1, 0]]);
    const db = raw(dbPath);
    try { db.exec("DELETE FROM knowledge_vectors"); } finally { db.close(); }
    expect(() => store.assertCompatible(compatible(itemIdentity))).toThrow(/vector|count|rebuild/i);
  });

  it("rejects equal-sized record and vector sets with different rowids or metadata", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const itemIdentity = identity(directory);
    const ready = build(store, itemIdentity, [record("one")], [[1, 0]]);
    const db = raw(dbPath);
    try {
      db.exec("DELETE FROM knowledge_vectors");
      db.prepare("INSERT INTO knowledge_vectors (record_rowid, embedding, generation_id) VALUES (999, ?, CAST(? AS INTEGER))")
        .run(Buffer.from(new Float32Array([1, 0]).buffer), ready.generationId);
    } finally { db.close(); }
    expect(() => store.assertCompatible(compatible(itemIdentity))).toThrow(/vector|rowid|rebuild/i);
  });

  it("removes an aborted generation's orphan vectors without deleting other generations", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const itemIdentity = identity(directory);
    const ready = build(store, itemIdentity, [record("one")], [[1, 0]]);
    const failed = begin(store, itemIdentity, [record("next")]);
    const db = raw(dbPath);
    try {
      db.prepare("INSERT INTO knowledge_vectors (record_rowid, embedding, generation_id) VALUES (999, ?, CAST(? AS INTEGER))")
        .run(Buffer.from(new Float32Array([0, 1]).buffer), failed.generationId);
      expect(() => store.publishBuild(failed)).toThrow(/vector|count/i);
      store.abortBuild(failed);
      expect(db.prepare("SELECT count(*) AS n FROM knowledge_vectors WHERE generation_id = ?")
        .get(failed.generationId).n).toBe(0);
      expect(db.prepare("SELECT count(*) AS n FROM knowledge_vectors WHERE generation_id = ?")
        .get(ready.generationId).n).toBe(1);
      expect(store.assertCompatible(compatible(itemIdentity)).generationId).toBe(ready.generationId);
    } finally { db.close(); }
  });

  it("rejects a corrupted native cosine distance instead of converting NULL to score one", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const generation = build(store, identity(directory), [record("one")], [[1, 0]]);
    const db = raw(dbPath);
    try {
      db.exec("DELETE FROM knowledge_vectors");
      db.prepare("INSERT INTO knowledge_vectors (record_rowid, embedding, generation_id) VALUES (1, ?, CAST(? AS INTEGER))")
        .run(Buffer.from(new Float32Array([1e-30, 0]).buffer), generation.generationId);
    } finally { db.close(); }
    expect(() => store.search({ generationId: generation.generationId, vector: [1, 0] })).toThrow(/distance|vector|rebuild/i);
  });

  it("creates an empty ready generation and supports memory preparation", () => {
    const store = open(":memory:");
    const generation = build(store, identity("/tmp"), [], []);
    expect(store.search({ generationId: generation.generationId, vector: [1, 0] })).toEqual([]);
    expect(store.inspect().active.itemCount).toBe(0);
  });

  it("binds SQL-looking identity and record values rather than interpolating them", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const itemIdentity = identity(directory, { model: "x'); DROP TABLE knowledge_records;--",
      inputProfile: "profile' OR 1=1--" });
    const item = record("'); DROP TABLE knowledge_manifest;--", "command'--");
    const generation = build(store, itemIdentity, [item], [[1, 0]], "fp'--");
    expect(store.assertCompatible(compatible(itemIdentity, "fp'--")).itemCount).toBe(1);
    expect(store.search({ generationId: generation.generationId, vector: [1, 0] })[0].id).toBe(item.id);
  });

  it("rejects existing unversioned or unsupported schema without overwriting it", () => {
    const { dbPath } = fixture();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.exec("CREATE TABLE valuable (value TEXT); INSERT INTO valuable VALUES ('preserve')");
    db.close();
    expect(() => open(dbPath)).toThrow(/schema|version|rebuild/i);
    const check = new Database(dbPath);
    expect(check.prepare("SELECT value FROM valuable").get().value).toBe("preserve");
    check.pragma("user_version = 99"); check.close();
    expect(() => open(dbPath, { readonly: true })).toThrow(/schema|version|rebuild/i);
  });

  it("provides build guidance for a missing read-only database", () => {
    const { dbPath } = fixture();
    expect(() => open(dbPath, { readonly: true })).toThrow(/build|knowledge/i);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it("defers schema creation until beginBuild and rejects an unbuilt file for reads", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const db = raw(dbPath);
    try {
      expect(db.pragma("user_version", { simple: true })).toBe(0);
      expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'knowledge_%'").get().n).toBe(0);
    } finally { db.close(); }
    expect(() => open(dbPath, { readonly: true })).toThrow(/schema|version|rebuild/i);
    begin(store, identity(directory), []);
    expect(open(dbPath, { readonly: true }).inspect().active).toBeNull();
  });

  it("rejects a falsely versioned schema and a mismatched native distance metric", () => {
    const { dbPath } = fixture();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    let db = raw(dbPath);
    db.pragma("user_version = 1"); db.close();
    expect(() => open(dbPath)).toThrow(/schema|rebuild/i);
    const { directory, dbPath: vectorPath } = fixture();
    const store = open(vectorPath);
    build(store, identity(directory), [record("one")], [[1, 0]]);
    store.close();
    db = raw(vectorPath);
    try {
      db.exec("DROP TABLE knowledge_vectors; CREATE VIRTUAL TABLE knowledge_vectors USING vec0(record_rowid INTEGER PRIMARY KEY, embedding FLOAT[2], generation_id INTEGER)");
    } finally { db.close(); }
    expect(() => open(vectorPath, { readonly: true })).toThrow(/metric|schema|rebuild/i);
  });

  it("canonicalizes the source path and removes only an aborted build's vectors", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const itemIdentity = identity(directory, { datasetPath: path.join(directory, "sub", "..", "dataset.jsonl") });
    const old = build(store, itemIdentity, [record("old")], [[1, 0]]);
    expect(store.inspect().identity.datasetPath).toBe(path.resolve(itemIdentity.datasetPath));
    const failed = begin(store, itemIdentity, [record("next")]);
    store.appendBatch({ generationId: failed.generationId, records: [record("next")], vectors: [[0, 1]] });
    store.abortBuild(failed);
    expect(() => store.search({ generationId: failed.generationId, vector: [1, 0] })).toThrow(/ready/i);
    expect(() => store.publishBuild(failed)).toThrow(/building/i);
    expect(store.search({ generationId: old.generationId, vector: [1, 0] })[0].id).toBe("old");
    const db = raw(dbPath);
    try {
      expect(db.prepare("SELECT count(*) AS n FROM knowledge_vectors").get().n).toBe(1);
      expect(db.prepare("SELECT status FROM knowledge_generations WHERE generation_id = ?").get(failed.generationId).status).toBe("failed");
    } finally { db.close(); }
  });

  it.each([0, -1, 1.5, 8193, "2"])("rejects an unsupported dimension %j before schema creation", dimensions => {
    const store = open(":memory:");
    expect(() => begin(store, identity("/tmp", { dimensions }), [])).toThrow(/dimension/i);
    expect(store.inspect()).toEqual({ identity: null, active: null });
  });

  it("expands candidates to satisfy command diversity", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const records = Array.from({ length: 80 }, (_, index) => record(`skew-${index}`, "skew"));
    records.push(record("other-a", "other-a"), record("other-b", "other-b"));
    const generation = build(store, identity(directory), records,
      [...Array.from({ length: 80 }, () => [1, 0]), [0.8, 0.6], [0, 1]]);
    expect(store.search({ generationId: generation.generationId, vector: [1, 0], topK: 4 })
      .map(hit => hit.command)).toEqual(["skew", "skew", "other-a", "other-b"]);
  });

  it("resolves a KNN boundary tie by binary id order even for reversed insertion", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const records = Array.from({ length: 80 }, (_, index) => record(`tie-${String(79 - index).padStart(3, "0")}`));
    const generation = build(store, identity(directory), records, records.map(() => [1, 0]));
    expect(store.search({ generationId: generation.generationId, vector: [1, 0], topK: 3 })
      .map(hit => hit.id)).toEqual(["tie-000", "tie-001", "tie-002"]);
  });

  it("orders tied ASCII and Unicode ids exactly like SQLite COLLATE BINARY", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const records = ["😀", "\uE000", "é", "a", "Z",
      ...Array.from({ length: 80 }, (_, index) => `😀tail-${index}`)].map(id => record(id));
    const generation = build(store, identity(directory), records, records.map(() => [1, 0]));
    expect(store.search({ generationId: generation.generationId, vector: [1, 0], topK: 5 })
      .map(hit => hit.id)).toEqual(["Z", "a", "é", "\uE000", "😀"]);
  });

  it("searches more than the native 4096 k limit while preserving tie order and diversity", () => {
    const { directory, dbPath } = fixture();
    const store = open(dbPath);
    const records = Array.from({ length: 4100 }, (_, index) => record(`tie-${String(4099 - index).padStart(4, "0")}`, "skew"));
    records.push(record("diverse", "other"));
    const generation = build(store, identity(directory), records,
      [...Array.from({ length: 4100 }, () => [1, 0]), [0, 1]]);
    expect(store.search({ generationId: generation.generationId, vector: [1, 0], topK: 3 })
      .map(hit => hit.id)).toEqual(["tie-0000", "tie-0001", "diverse"]);
    expect(store.search({ generationId: generation.generationId, vector: [1, 0], topK: 4097, maxPerCommand: 5000 }))
      .toHaveLength(4097);
  }, 20000);
});
