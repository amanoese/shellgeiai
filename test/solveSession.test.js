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

  it("normalizes programmatic on knowledge mode to all before capability validation", async () => {
    await expect(
      createSolveSession({
        problemInput: "print 42",
        engine: { name: "legacy", generateCommand: async () => ({ command: "printf '42\\n'" }) },
        runner: { name: "mock" },
        judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
        maxIterations: 1,
        knowledgeMode: "on",
        knowledgeRetriever: { retrieveForPlanner: async () => [] },
        plannerProvider: createTestPlannerProvider()
      })
    ).rejects.toThrow(
      'Engine "legacy" does not support Tool Calling required by --knowledge all. Use a Tool Calling capable engine, or select --knowledge planner/off.'
    );
  });

  it.each([
    { label: "false", capabilities: { toolCalling: false }, engineName: "legacy" },
    { label: "missing", capabilities: undefined, engineName: undefined },
    {
      label: "true without generateTurn",
      capabilities: { toolCalling: true },
      engineName: "incomplete-tool-engine"
    }
  ])(
    "rejects worker knowledge when Tool Calling capability is $label before retrieval and planning",
    async ({ capabilities, engineName }) => {
      const retrieveForPlanner = vi.fn(async () => []);
      const plannerProvider = createTestPlannerProvider();
      const buildPlan = vi.spyOn(plannerProvider, "buildPlan");

      await expect(
        createSolveSession({
          problemInput: "print 42",
          engine: {
            ...(engineName ? { name: engineName } : {}),
            ...(capabilities ? { capabilities } : {}),
            generateCommand: async () => ({ command: "printf '42\\n'" })
          },
          runner: { name: "mock" },
          judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
          maxIterations: 1,
          knowledgeMode: "all",
          knowledgeRetriever: { retrieveForPlanner, search: vi.fn() },
          plannerProvider
        })
      ).rejects.toThrow(
        `Engine "${engineName ?? "unknown"}" does not support Tool Calling required by --knowledge all. Use a Tool Calling capable engine, or select --knowledge planner/off.`
      );
      expect(retrieveForPlanner).not.toHaveBeenCalled();
      expect(buildPlan).not.toHaveBeenCalled();
    }
  );

  it("registers only search_knowledge for capable worker knowledge sessions", async () => {
    const knowledgeRetriever = { search: vi.fn(async () => []) };
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: {
        name: "tool-engine",
        capabilities: { toolCalling: true },
        generateTurn: vi.fn()
      },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      knowledgeMode: "worker",
      knowledgeRetriever,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.toolRegistry.definitions().map((definition) => definition.name)).toEqual([
      "search_knowledge"
    ]);
    expect(session.knowledgeRetriever).toBe(knowledgeRetriever);
  });

  it("retrieves planner knowledge before planning without injecting worker hints", async () => {
    const events = [];
    const plannerKnowledgeHints = [
      {
        id: "man:awk:-F",
        command: "awk",
        option: "-F",
        text: "Split input fields.",
        source: "test"
      }
    ];
    const knowledgeRetriever = {
      retrieveForPlanner: vi.fn(async (input) => {
        events.push({ type: "retrieve", input });
        return plannerKnowledgeHints;
      })
    };
    const basePlannerProvider = createTestPlannerProvider();
    const plannerProvider = {
      ...basePlannerProvider,
      buildPlan: vi.fn(async (plannerSession) => {
        events.push({
          type: "plan",
          plannerKnowledgeHints: plannerSession.plannerKnowledgeHints
        });
        return basePlannerProvider.buildPlan(plannerSession);
      })
    };

    const session = await createSolveSession({
      problemInput: "expected_output:\n42\n---\nCSV の 3列目を合計する",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      parallelism: 2,
      knowledgeMode: "planner",
      knowledgeRetriever,
      plannerProvider
    });

    expect(events).toEqual([
      {
        type: "retrieve",
        input: {
          problem: "CSV の 3列目を合計する",
          expectedOutput: "42"
        }
      },
      { type: "plan", plannerKnowledgeHints }
    ]);
    expect(session.plannerKnowledgeHints).toEqual(plannerKnowledgeHints);
    expect(session.plan.workerTasks).toHaveLength(2);
    expect(session.plan.workerTasks.every((task) => !("knowledgeHints" in task))).toBe(true);
  });

  it.each([
    { knowledgeMode: "planner", retrievesForPlanner: true },
    { knowledgeMode: "worker", retrievesForPlanner: false },
    { knowledgeMode: "all", retrievesForPlanner: true }
  ])(
    "automatically initializes and routes $knowledgeMode knowledge",
    async ({ knowledgeMode, retrievesForPlanner }) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-session-mode-"));
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
            model: "test-ruri-model",
            dataset: datasetPath,
            datasetFingerprint: fingerprint(datasetContent),
            createdAt: "2026-08-02T00:00:00.000Z"
          }),
          JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
          ""
        ].join("\n"),
        "utf8"
      );
      const embed = vi.fn(async () => [1, 0]);

      const session = await createSolveSession({
        problemInput: "CSV の 3列目を合計する",
        engine: {
          name: "mock",
          capabilities: { toolCalling: true },
          generateTurn: async () => ({ type: "command", command: "printf '42\\n'" })
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
        knowledgeMode,
        knowledgeModel: "test-ruri-model",
        knowledgeDatasetPath: datasetPath,
        knowledgeVectorsPath: vectorsPath,
        knowledgeEmbedder: { embed },
        plannerProvider: createTestPlannerProvider()
      });

      expect(session.knowledgeRetriever).toBeDefined();
      expect(session.plan.knowledgeMode).toBe(knowledgeMode);
      expect(session.plannerKnowledgeHints.length > 0).toBe(retrievesForPlanner);
      expect(embed).toHaveBeenCalledTimes(retrievesForPlanner ? 1 : 0);
      expect(session.plan.workerTasks.every((task) => !("knowledgeHints" in task))).toBe(true);
    }
  );

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

  it("retrieves planner hints from precomputed vectors without recomputing document embeddings", async () => {
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
      knowledgeMode: "planner",
      knowledgeDatasetPath: datasetPath,
      knowledgeVectorsPath: vectorsPath,
      knowledgeEmbedder: embedder,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.plannerKnowledgeHints).toEqual([
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
        knowledgeMode: "planner",
        knowledgeModel: "active-model",
        knowledgeDatasetPath: datasetPath,
        knowledgeVectorsPath: vectorsPath,
        knowledgeEmbedder: { embed: vi.fn(async () => [1, 0]) },
        plannerProvider: createTestPlannerProvider()
      })
    ).rejects.toThrow("Knowledge vector file is incompatible with the active model or dataset");
  });

  it("retrieves planner hints from the packaged cache without recomputing document embeddings", async () => {
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
      knowledgeMode: "planner",
      knowledgeEmbedder: embedder,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.plannerKnowledgeHints.length).toBeGreaterThan(0);
    expect(embedder.embed).toHaveBeenCalledWith(expect.stringContaining("検索クエリ:"));
    expect(embedder.embed).not.toHaveBeenCalledWith(expect.stringContaining("検索文書:"));
  });

  it("passes the selected knowledge model while retrieving cached planner hints", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-session-"));
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const datasetContent = `${JSON.stringify({
      id: "man:awk:-F",
      kind: "option",
      command: "awk",
      option: "-F",
      text: "awk -F: CSV columns",
      source: "test"
    })}\n`;
    await fs.writeFile(datasetPath, datasetContent, "utf8");
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      vectorsPath,
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 1,
          model: "test-ruri-model",
          dataset: datasetPath,
          datasetFingerprint: fingerprint(datasetContent),
          createdAt: "2026-08-02T00:00:00.000Z"
        }),
        JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
        ""
      ].join("\n"),
      "utf8"
    );
    const embed = vi.fn(async () => [1, 0]);
    const createKnowledgeEmbedder = vi.fn(() => ({ embed }));

    const session = await createSolveSession({
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
      knowledgeMode: "planner",
      knowledgeModel: "test-ruri-model",
      knowledgeDatasetPath: datasetPath,
      knowledgeVectorsPath: vectorsPath,
      knowledgeEmbedderFactory: createKnowledgeEmbedder,
      plannerProvider: createTestPlannerProvider()
    });

    expect(createKnowledgeEmbedder).toHaveBeenCalledWith({
      model: "test-ruri-model"
    });
    expect(session.plannerKnowledgeHints).toEqual([
      expect.objectContaining({ id: "man:awk:-F" })
    ]);
    expect(embed).toHaveBeenCalledWith(expect.stringContaining("検索クエリ:"));
    expect(embed).not.toHaveBeenCalledWith(expect.stringContaining("検索文書:"));
  });
});
