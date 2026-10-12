import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKnowledgeVectors, prepareKnowledgeModel, searchKnowledge } from "../dist/knowledge/commands.js";
import { openKnowledgeStore } from "../dist/knowledge/sqliteStore.js";
import { formatEmbeddingQuery } from "../dist/knowledge/embeddingInputs.js";
import { documentEmbedder, knowledgeFixture, knowledgeRecord } from "./support/knowledgeFixture.js";

const dirs = [];
async function fixture(records) {
  const value = await knowledgeFixture(records);
  dirs.push(value.dir);
  return value;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

describe("persisted knowledge commands", () => {
  it("prepares native SQLite and warms one formatted query", async () => {
    const embedder = { embed: vi.fn(async () => [1, 0]) };
    await expect(prepareKnowledgeModel({ embedder })).resolves.toMatchObject({
      model: "qwen/qwen3-embedding-8b", provider: "openrouter", dimensions: 2, prepared: true
    });
    expect(embedder.embed).toHaveBeenCalledOnce();
    expect(embedder.embed.mock.calls[0][0]).toBe(formatEmbeddingQuery("warmup"));
  });
  it("builds once, reopens, and searches with one query API request only", async () => {
    const options = await fixture();
    const embedder = documentEmbedder();
    const built = await buildKnowledgeVectors({ ...options, embedder });
    expect(built).toMatchObject({ dbPath: options.dbPath, itemCount: 2, dimensions: 2, reused: false });
    expect(embedder.embedBatch.mock.calls[0][0]).toEqual(["awk columns", "sort values"]);
    const queryEmbedder = { embed: vi.fn(async () => [0, 1]) };
    const searched = await searchKnowledge({ ...options, query: "values", topK: 1, embedder: queryEmbedder });
    expect(searched.results[0]).toMatchObject({ id: "sort", score: 1 });
    expect(queryEmbedder.embed).toHaveBeenCalledOnce();
    expect(queryEmbedder.embed.mock.calls[0][0]).toBe(formatEmbeddingQuery("values"));
  });
  it("reuses a compatible database with no provider key, while force rebuilds", async () => {
    const options = await fixture();
    const first = await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    expect(await buildKnowledgeVectors(options)).toMatchObject({ generationId: first.generationId, reused: true });
    const embedder = documentEmbedder();
    expect(await buildKnowledgeVectors({ ...options, embedder, force: true })).toMatchObject({ reused: false });
    expect(embedder.embedBatch).toHaveBeenCalledOnce();
  });
  it.each([0, 65, 1.5])("rejects invalid batch size %s before API calls", async batchSize => {
    const options = await fixture();
    const embedder = documentEmbedder();
    await expect(buildKnowledgeVectors({ ...options, embedder, batchSize })).rejects.toThrow("batch");
    expect(embedder.embedBatch).not.toHaveBeenCalled();
  });
  it.each(["", "  ", 4])("rejects invalid model before API or database creation", async model => {
    const options = await fixture();
    const embedder = documentEmbedder();
    await expect(buildKnowledgeVectors({ ...options, embedder, model })).rejects.toThrow("model");
    expect(embedder.embedBatch).not.toHaveBeenCalled();
    await expect(fs.stat(options.dbPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["", "bad timestamp", 12])("validates build timestamp before API or database creation", async timestamp => {
    const options = await fixture();
    const embedder = documentEmbedder();
    const now = vi.fn(() => timestamp);
    await expect(buildKnowledgeVectors({ ...options, embedder, now })).rejects.toThrow("time");
    expect(embedder.embedBatch).not.toHaveBeenCalled();
    expect(now).toHaveBeenCalledOnce();
    await expect(fs.stat(options.dbPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects blank models in prepare and search before query API", async () => {
    const options = await fixture();
    const embedder = { embed: vi.fn(async () => [1, 0]) };
    await expect(prepareKnowledgeModel({ embedder, model: " " })).rejects.toThrow("model");
    await expect(searchKnowledge({ ...options, query: "awk", embedder, model: " " })).rejects.toThrow("model");
    expect(embedder.embed).not.toHaveBeenCalled();
  });
  it("splits batches by count and combined UTF8 bytes", async () => {
    const options = await fixture([knowledgeRecord("a", "あ".repeat(30000)), knowledgeRecord("b", "b".repeat(50000)), knowledgeRecord("c")]);
    const embedder = documentEmbedder();
    await buildKnowledgeVectors({ ...options, embedder, batchSize: 2 });
    expect(embedder.embedBatch.mock.calls.map(call => call[0].length)).toEqual([1, 2]);
  });
  it.each([
    { label: "empty dataset", records: [], message: "empty" },
    { label: "duplicate ids", records: [knowledgeRecord("a"), knowledgeRecord("a")], message: "Duplicate" },
    { label: "oversize UTF8 input", records: [knowledgeRecord("a", "あ".repeat(44000))], message: "128" }
  ])("rejects $label before provider calls", async ({ records, message }) => {
    const options = await fixture(records);
    const embedder = documentEmbedder();
    await expect(buildKnowledgeVectors({ ...options, embedder })).rejects.toThrow(message);
    expect(embedder.embedBatch).not.toHaveBeenCalled();
    await expect(fs.stat(options.dbPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not create a database when first request fails or returns invalid vectors", async () => {
    for (const embedder of [{ embedBatch: async () => { throw new Error("first failed"); } }, { embedBatch: async () => [[0, 0], [0, 0]] }]) {
      const options = await fixture();
      await expect(buildKnowledgeVectors({ ...options, embedder })).rejects.toThrow();
      await expect(fs.stat(options.dbPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  it("does not create a database for unsupported first-batch dimensions", async () => {
    const options = await fixture();
    const embedder = { embedBatch: async texts => texts.map(() => Array(8193).fill(1)) };
    await expect(buildKnowledgeVectors({ ...options, embedder })).rejects.toThrow("8192");
    await expect(fs.stat(options.dbPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves the active generation after a later batch failure", async () => {
    const options = await fixture();
    const first = await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    const embedder = { embedBatch: vi.fn().mockResolvedValueOnce([[1, 0]]).mockRejectedValueOnce(new Error("partial failure")) };
    await expect(buildKnowledgeVectors({ ...options, force: true, batchSize: 1, embedder })).rejects.toThrow("partial failure");
    const store = openKnowledgeStore({ dbPath: options.dbPath, readonly: true });
    expect(store.inspect().active.generationId).toBe(first.generationId);
    store.close();
  });
  it("checks existing model identity before API even with force", async () => {
    const options = await fixture();
    await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    const embedder = documentEmbedder();
    await expect(buildKnowledgeVectors({ ...options, model: "other", force: true, embedder })).rejects.toThrow("model mismatch");
    expect(embedder.embedBatch).not.toHaveBeenCalled();
  });
  it.each(["missing", "stale", "model"])("rejects %s database before query API and includes rebuild help", async reason => {
    const options = await fixture();
    if (reason !== "missing") await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    if (reason === "stale") await fs.appendFile(options.datasetPath, "\n ");
    const embedder = { embed: vi.fn(async () => [1, 0]) };
    await expect(searchKnowledge({ ...options, ...(reason === "model" ? { model: "other" } : {}), query: "awk", embedder }))
      .rejects.toThrow("shellgeiai knowledge build --dataset");
    expect(embedder.embed).not.toHaveBeenCalled();
  });
  it("rejects blank query and returns topK zero without API", async () => {
    const options = await fixture();
    const embedder = { embed: vi.fn() };
    await expect(searchKnowledge({ ...options, query: " ", embedder })).rejects.toThrow("query");
    expect((await searchKnowledge({ ...options, query: "awk", topK: 0, embedder })).results).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });
  it("refuses publication if cancelled or dataset changes during embedding", async () => {
    for (const change of ["abort", "dataset"]) {
      const options = await fixture();
      const controller = new AbortController();
      const embedder = { embedBatch: async texts => {
        if (change === "abort") controller.abort();
        else await fs.appendFile(options.datasetPath, "\n ");
        return texts.map(() => [1, 0]);
      } };
      await expect(buildKnowledgeVectors({ ...options, embedder, signal: controller.signal })).rejects.toThrow();
      try {
        const store = openKnowledgeStore({ dbPath: options.dbPath, readonly: true });
        expect(store.inspect().active).toBeNull();
        store.close();
      } catch (error) {
        if (!String(error.message).includes("does not exist")) throw error;
      }
    }
  });
});
