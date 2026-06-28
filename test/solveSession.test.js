import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reportSessionPhase } from "../src/solve/session/progress.js";
import { createSolveSession } from "../src/solve/session/solveSession.js";
import { SESSION_PHASES } from "../src/solve/session/sessionPhases.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

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

  it("adds knowledge hints to worker tasks when worker knowledge is enabled", async () => {
    const knowledgeRetriever = {
      async retrieveForWorker({ task }) {
        return [
          {
            id: `hint:${task.workerId}`,
            kind: "option",
            command: "awk",
            option: "-F",
            text: "awk -F: CSV の列を処理する",
            source: "test",
            score: 1
          }
        ];
      }
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
    expect(session.plan.workerTasks[0].knowledgeHints).toEqual([
      expect.objectContaining({ id: "hint:worker-1", text: "awk -F: CSV の列を処理する" })
    ]);
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

  it("uses precomputed knowledge vectors when worker knowledge is enabled", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-session-"));
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.json");
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
        version: 1,
        model: "test-model",
        dataset: datasetPath,
        createdAt: "2026-06-29T00:00:00.000Z",
        items: [{ id: "man:awk:-F", vector: [1, 0] }]
      })}\n`,
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

    expect(session.plan.workerTasks[0].knowledgeHints).toEqual([
      expect.objectContaining({ id: "man:awk:-F", score: 1 })
    ]);
    expect(embedder.embed).toHaveBeenCalledWith(expect.stringContaining("検索クエリ:"));
    expect(embedder.embed).not.toHaveBeenCalledWith(expect.stringContaining("検索文書:"));
  });

  it("passes selected knowledge model to worker knowledge embedder", async () => {
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
