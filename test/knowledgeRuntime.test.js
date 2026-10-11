import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKnowledgeVectors } from "../src/knowledge/commands.js";
import { createKnowledgeRuntime } from "../src/knowledge/knowledgeRuntime.js";
import { documentEmbedder, knowledgeFixture, knowledgeRecord } from "./support/knowledgeFixture.js";

const dirs = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
describe("knowledge runtime lifecycle", () => {
  it("preserves planner and worker diversity with at most five bounded results", async () => {
    const records = ["awk-1", "awk-2", "awk-3", "sort-1", "uniq-1", "cut-1", "sed-1"].map(id =>
      knowledgeRecord(id, id, id.split("-")[0]));
    const options = await knowledgeFixture(records); dirs.push(options.dir);
    await buildKnowledgeVectors({ ...options, embedder: { embedBatch: async texts => texts.map(() => [1, 0]) } });
    const embed = vi.fn(async () => [1, 0]);
    const runtime = await createKnowledgeRuntime({ ...options, embedder: { embed } });
    try {
      const planner = await runtime.retriever.retrieveForPlanner({ problem: "columns" });
      const worker = await runtime.retriever.search({ query: "columns" });
      expect(planner).toHaveLength(5);
      expect(planner.filter(record => record.command === "awk")).toHaveLength(1);
      expect(worker).toHaveLength(5);
      expect(worker.filter(record => record.command === "awk")).toHaveLength(2);
      expect(Object.keys(worker[0])).toEqual(["id", "command", "option", "text", "source"]);
      expect(embed).toHaveBeenCalledOnce();
    } finally { await runtime.dispose(); }
  });
  it("pins its ready generation across a concurrent publication and closes idempotently", async () => {
    const options = await knowledgeFixture(); dirs.push(options.dir);
    const first = await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    const runtime = await createKnowledgeRuntime({ ...options, embedder: { embed: async () => [1, 0] } });
    const second = await buildKnowledgeVectors({ ...options, force: true, embedder: { embedBatch: async texts => texts.map(() => [0, 1]) } });
    expect(second.generationId).not.toBe(first.generationId);
    expect(runtime.snapshot.generationId).toBe(first.generationId);
    expect((await runtime.search({ query: "awk", topK: 1 }))[0].id).toBe("awk");
    await runtime.dispose(); await runtime.dispose();
    await expect(runtime.search({ query: "other" })).rejects.toThrow("closed");
  });
  it("does not construct an embedder until database validation passes", async () => {
    const options = await knowledgeFixture(); dirs.push(options.dir);
    const embedderFactory = vi.fn();
    await expect(createKnowledgeRuntime({ ...options, embedderFactory })).rejects.toThrow("knowledge build");
    expect(embedderFactory).not.toHaveBeenCalled();
  });
  it("validates model before reading dataset or constructing provider", async () => {
    const embedderFactory = vi.fn();
    await expect(createKnowledgeRuntime({ datasetPath: "/missing/knowledge.jsonl", dbPath: "/missing/knowledge.sqlite", model: " ", embedderFactory }))
      .rejects.toThrow("Embedding model must be a nonempty string.");
    expect(embedderFactory).not.toHaveBeenCalled();
  });
  it("imports solve and commands and creates an off session without loading native dependencies or fetching", async () => {
    const source = `import { createRequire } from 'node:module';
      globalThis.fetch = () => { throw new Error('unexpected fetch'); };
      const { createSolveSession } = await import('./src/solve/session/solveSession.js');
      await import('./src/knowledge/commands.js');
      const { createTestPlannerProvider } = await import('./test/support/testPlannerProvider.js');
      const session = await createSolveSession({ problemInput: 'print ok', engine: { name: 'mock' }, runner: { name: 'mock' }, judge: {},
        maxIterations: 1, knowledgeMode: 'off', plannerProvider: createTestPlannerProvider() });
      await session.dispose();
      const cache = Object.keys(createRequire(import.meta.url).cache);
      if (cache.some(key => key.includes('better-sqlite3') || key.includes('sqlite-vec'))) throw new Error('native loaded');`;
    const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", source], { cwd: process.cwd(), env: { ...process.env, OPENROUTER_API_KEY: "" } });
    expect(result.stderr).toBe("");
  });
});
