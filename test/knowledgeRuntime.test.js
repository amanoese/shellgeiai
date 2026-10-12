import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKnowledgeVectors, searchKnowledge } from "../dist/knowledge/commands.js";
import { createKnowledgeRuntime } from "../dist/knowledge/knowledgeRuntime.js";
import { createSolveSession } from "../dist/solve/solve.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";
import { documentEmbedder, knowledgeFixture, knowledgeRecord } from "./support/knowledgeFixture.js";

const dirs = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
describe("knowledge runtime lifecycle", () => {
  it("prints a runnable same-path build for a missing database", async () => {
    const options = await knowledgeFixture(); dirs.push(options.dir);
    const failure = await createKnowledgeRuntime(options).catch(error => error);
    const recommended = parseRebuildHint(failure.message);
    expect(recommended).toMatchObject({ dbPath: options.dbPath, force: false });
    await buildKnowledgeVectors({ ...recommended, embedder: documentEmbedder() });
    const runtime = await createKnowledgeRuntime({ ...recommended, embedder: { embed: async () => [1, 0] } });
    await runtime.dispose();
  });
  it.each(["stale", "integrity"])("prints a runnable same-path force rebuild for %s knowledge", async problem => {
    const options = await knowledgeFixture(); dirs.push(options.dir);
    await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    if (problem === "stale") await fs.appendFile(options.datasetPath, "\n ");
    else {
      const db = new Database(options.dbPath);
      db.prepare("DELETE FROM knowledge_records WHERE id = ?").run("awk");
      db.close();
    }
    const failure = await createKnowledgeRuntime(options).catch(error => error);
    const recommended = parseRebuildHint(failure.message);
    expect(recommended.dbPath).toBe(options.dbPath);
    expect(recommended.force).toBe(true);
    await buildKnowledgeVectors({ ...recommended, embedder: documentEmbedder() });
    expect((await searchKnowledge({ ...recommended, query: "awk", embedder: { embed: async () => [1, 0] } })).results[0].id).toBe("awk");
  });
  it.each(["model", "profile", "schema"])("prints a runnable fresh-path rebuild for %s mismatch and preserves the old database", async problem => {
    const options = await knowledgeFixture(); dirs.push(options.dir);
    await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    if (problem !== "model") {
      const db = new Database(options.dbPath);
      if (problem === "profile") db.prepare("UPDATE knowledge_manifest SET input_profile = ?").run("obsolete-profile");
      else db.pragma("user_version = 999");
      db.close();
    }
    const before = await fs.readFile(options.dbPath);
    const requested = { ...options, ...(problem === "model" ? { model: "new-model" } : {}) };
    const failure = await createKnowledgeRuntime(requested).catch(error => error);
    const recommended = parseRebuildHint(failure.message);
    expect(recommended.dbPath).not.toBe(options.dbPath);
    expect(failure.message).toContain(`search --db '${recommended.dbPath}'`);
    expect(failure.message).toContain(`solve --knowledge-db '${recommended.dbPath}'`);
    await buildKnowledgeVectors({ ...recommended, embedder: documentEmbedder() });
    expect((await searchKnowledge({ ...recommended, query: "awk", embedder: { embed: async () => [1, 0] } })).results[0].id).toBe("awk");
    const session = await createSolveSession({
      problemInput: "awk columns", engine: { name: "test" }, runner: { name: "mock" }, judge: {}, maxIterations: 1,
      knowledgeMode: "planner", knowledgeDbPath: recommended.dbPath, knowledgeDatasetPath: recommended.datasetPath,
      knowledgeModel: recommended.model, knowledgeEmbedder: { embed: async () => [1, 0] }, plannerProvider: createTestPlannerProvider()
    });
    try { expect(session.knowledgeSnapshot.dbPath).toBe(recommended.dbPath); }
    finally { await session.dispose(); }
    expect(await fs.readFile(options.dbPath)).toEqual(before);
  });
  it("chooses an unused new path without overwriting an earlier recovery target", async () => {
    const options = await knowledgeFixture(); dirs.push(options.dir);
    await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    const occupied = `${options.dbPath}.rebuilt.sqlite`;
    await fs.writeFile(occupied, "keep this recovery artifact");
    const failure = await createKnowledgeRuntime({ ...options, model: "new-model" }).catch(error => error);
    const recommended = parseRebuildHint(failure.message);
    expect(recommended.dbPath).not.toBe(occupied);
    await buildKnowledgeVectors({ ...recommended, embedder: documentEmbedder() });
    expect(await fs.readFile(occupied, "utf8")).toBe("keep this recovery artifact");
  });
  it("does not suggest rebuilding for provider configuration failures", async () => {
    const options = await knowledgeFixture(); dirs.push(options.dir);
    await buildKnowledgeVectors({ ...options, embedder: documentEmbedder() });
    const failure = await createKnowledgeRuntime({ ...options, embedderFactory: () => { throw new Error("Invalid embedding timeout setting."); } }).catch(error => error);
    expect(failure.message).toBe("Invalid embedding timeout setting.");
  });
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
      const { createSolveSession } = await import('./dist/solve/solve.js');
      await import('./dist/knowledge/commands.js');
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

function parseRebuildHint(message) {
  const command = message.split("\n").find(line => line.startsWith("Rebuild with: "));
  expect(command).toBeDefined();
  const option = name => command.match(new RegExp(`--${name} '([^']+)'`))?.[1];
  return { datasetPath: option("dataset"), dbPath: option("db"), model: option("model"), force: command.includes("--force") };
}
