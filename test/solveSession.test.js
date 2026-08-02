import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reportSessionPhase } from "../src/solve/session/progress.js";
import { createSolveSession } from "../src/solve/session/solveSession.js";
import { SESSION_PHASES } from "../src/solve/session/sessionPhases.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";
import { DEFAULT_KNOWLEDGE_VECTORS } from "../src/knowledge/commands.js";
import { loadKnowledgeVectorFile } from "../src/knowledge/vectorFile.js";

function fingerprint(content) {
  return createHash("sha256").update(content).digest("hex");
}

describe("SESSION_PHASES", () => {
  it("defines ordered main solve phases", () => {
    expect(SESSION_PHASES).toEqual([
      "initializing",
      "problem-parsing",
      "planning",
      "executing",
      "selecting",
      "logging",
      "completed"
    ]);
  });
});

describe("progress helpers", () => {
  it("reports session-phase events with ordering metadata", () => {
    const events = [];
    const session = {
      sessionId: "session-1",
      onProgress: (event) => events.push(event)
    };

    reportSessionPhase(session, "planning", "Building execution plan.");

    expect(events).toEqual([
      {
        type: "session-phase",
        sessionId: "session-1",
        phase: "planning",
        phaseIndex: 3,
        phaseCount: 7,
        message: "Building execution plan."
      }
    ]);
  });
});

describe("createSolveSession", () => {
  it("defaults shellgei score mode simple", async () => {
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.shellgeiScoreMode).toBe("simple");
  });

  it("defaults knowledge mode off", async () => {
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.knowledgeMode).toBe("off");
  });

  it("normalizes programmatic on knowledge mode to all", async () => {
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      knowledgeMode: "on",
      knowledgeRetriever: { retrieveForWorker: async () => [] },
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.knowledgeMode).toBe("all");
  });

  it("does not search or inject hints while initializing worker knowledge", async () => {
    const knowledgeRetriever = {
      search: vi.fn(async () => [])
    };

    const session = await createSolveSession({
      problemInput: "CSV の 3列目を合計する",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      parallelism: 2,
      knowledgeMode: "worker",
      knowledgeRetriever,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.plan.workerTasks).toHaveLength(2);
    expect(knowledgeRetriever.search).not.toHaveBeenCalled();
    expect(session.plan.workerTasks[0]).not.toHaveProperty("knowledgeHints");
  });

  it("reports initializing, problem-parsing, planning while building a session", async () => {
    const events = [];

    await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider(),
      onProgress: (event) => events.push(event)
    });

  expect(
    events.filter((event) => event.type === "session-phase").map((event) => event.phase)
  ).toEqual(["initializing", "problem-parsing", "planning"]);
  });

  it("prepares precomputed vectors without initial worker hint retrieval", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-session-"));
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    const datasetContent = `${JSON.stringify({
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: "awk -F: CSV columns",
        source: "test"
      })}\n`;
    await fs.writeFile(datasetPath, datasetContent, "utf8");
    await fs.writeFile(
      vectorsPath,
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 1,
          model: "sirasagi62/ruri-v3-30m-ONNX",
          dataset: datasetPath,
          datasetFingerprint: fingerprint(datasetContent),
          createdAt: "2026-06-29T00:00:00.000Z"
        }),
        JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
        ""
      ].join("\n"),
      "utf8"
    );
    const embedder = {
      embed: vi.fn(async (text) => {
        if (text.startsWith("検索文書:")) {
          throw new Error("document embedding should not run");
        }
        return [1, 0];
      })
    };

    const session = await createSolveSession({
      problemInput: "CSV の 3列目を合計する",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: {
        judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } })
      },
      maxIterations: 1,
      parallelism: 2,
      knowledgeMode: "worker",
      knowledgeDatasetPath: datasetPath,
      knowledgeVectorsPath: vectorsPath,
      knowledgeEmbedder: embedder,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.plan.workerTasks[0]).not.toHaveProperty("knowledgeHints");
    expect(embedder.embed).not.toHaveBeenCalled();

    const hints = await session.knowledgeRetriever.search({ query: "CSV" });

    expect(hints).toEqual([
      expect.objectContaining({ id: "man:awk:-F" })
    ]);
    expect(embedder.embed).toHaveBeenCalledWith(expect.stringContaining("検索クエリ:"));
    expect(embedder.embed).not.toHaveBeenCalledWith(expect.stringContaining("検索文書:"));
  });

  it("rejects precomputed vectors built for a different knowledge model", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-session-"));
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      datasetPath,
      `${JSON.stringify({
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: "awk -F: CSV columns",
        source: "test"
      })}\n`,
      "utf8"
    );
    await fs.writeFile(
      vectorsPath,
      `${JSON.stringify({
        type: "metadata",
        version: 2,
        itemCount: 1,
        model: "different-model",
        dataset: datasetPath,
        createdAt: "2026-07-14T00:00:00.000Z"
      })}\n${JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] })}\n`,
      "utf8"
    );

    await expect(
      createSolveSession({
        problemInput: "CSV の 3列目を合計する",
        engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
        runner: { name: "mock" },
        judge: {
          judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } })
        },
        maxIterations: 1,
        parallelism: 2,
        knowledgeMode: "worker",
        knowledgeModel: "active-model",
        knowledgeDatasetPath: datasetPath,
        knowledgeVectorsPath: vectorsPath,
        knowledgeEmbedder: { embed: vi.fn(async () => [1, 0]) },
        plannerProvider: createTestPlannerProvider()
      })
    ).rejects.toThrow("Knowledge vector file is incompatible with the active model or dataset");
  });

  it("prepares the packaged default JSONL cache for on-demand worker knowledge", async () => {
    const vectorFile = await loadKnowledgeVectorFile(DEFAULT_KNOWLEDGE_VECTORS);
    const embedder = { embed: vi.fn(async () => vectorFile.items[0].vector) };

    const session = await createSolveSession({
      problemInput: "CSV の 3列目を合計する",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: {
        judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } })
      },
      maxIterations: 1,
      parallelism: 2,
      knowledgeMode: "worker",
      knowledgeEmbedder: embedder,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.plan.workerTasks[0]).not.toHaveProperty("knowledgeHints");
    expect(embedder.embed).not.toHaveBeenCalled();

    const hints = await session.knowledgeRetriever.search({ query: "CSV" });

    expect(hints.length).toBeGreaterThan(0);
    expect(embedder.embed).toHaveBeenCalledWith(expect.stringContaining("検索クエリ:"));
    expect(embedder.embed).not.toHaveBeenCalledWith(expect.stringContaining("検索文書:"));
  });

  it("passes selected knowledge model to the on-demand knowledge embedder", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-session-"));
    const datasetPath = path.join(dir, "knowledge.jsonl");
    await fs.writeFile(
      datasetPath,
      `${JSON.stringify({
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: "awk -F: CSV columns",
        source: "test"
      })}\n`,
      "utf8"
    );

    const createKnowledgeEmbedder = vi.fn(() => ({
      embed: vi.fn(async () => [1, 0])
    }));

    await createSolveSession({
      problemInput: "print 42",
      engine: {
        name: "mock",
        generateCommand: async () => ({ command: "printf '42\\n'" })
      },
      runner: { name: "mock" },
      judge: {
        judge: async () => ({
          passed: true,
          reason: "ok",
          score: { value: 100, breakdown: {} }
        })
      },
      maxIterations: 1,
      parallelism: 2,
      knowledgeMode: "worker",
      knowledgeModel: "test-ruri-model",
      knowledgeDatasetPath: datasetPath,
      knowledgeVectorsPath: path.join(dir, "missing.vectors.json"),
      knowledgeEmbedderFactory: createKnowledgeEmbedder,
      plannerProvider: createTestPlannerProvider()
    });

    expect(createKnowledgeEmbedder).toHaveBeenCalledWith({
      model: "test-ruri-model"
    });
  });
});
