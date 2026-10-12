import { describe, expect, it, vi } from "vitest";
import { solveProblem } from "../src/solve/solve.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

const boundaries = vi.hoisted(() => ({ execute: vi.fn(), log: vi.fn() }));
vi.mock("../src/solve/orchestration/orchestrator.js", () => ({ runSolveOrchestrator: boundaries.execute }));
vi.mock("../src/io/logs/writer.js", () => ({ writeSolveSessionLog: boundaries.log }));

function options(runtime) {
  return { problemInput: "print ok", engine: { name: "mock" }, runner: { name: "mock" }, judge: {}, maxIterations: 1,
    knowledgeMode: "planner", knowledgeRuntimeFactory: async () => runtime, plannerProvider: createTestPlannerProvider() };
}
describe("solve owned knowledge lifecycle", () => {
  it.each(["success", "orchestrator", "logging"])("closes the runtime after %s", async outcome => {
    const runtime = { retriever: { retrieveForPlanner: async () => [] }, snapshot: {}, dispose: vi.fn(async () => {}) };
    boundaries.execute.mockReset().mockImplementation(async () => {
      if (outcome === "orchestrator") throw new Error("orchestrator failed");
      return { candidates: [], attempts: [], workerSummaries: [] };
    });
    boundaries.log.mockReset().mockImplementation(async () => {
      expect(runtime.dispose).not.toHaveBeenCalled();
      await Promise.resolve();
      if (outcome === "logging") throw new Error("logging failed");
      return { logPath: "/tmp/test-log.json" };
    });
    if (outcome === "success") await expect(solveProblem(options(runtime))).resolves.toMatchObject({ logPath: "/tmp/test-log.json" });
    else await expect(solveProblem(options(runtime))).rejects.toThrow(outcome + " failed");
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});
