import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const reporter = vi.fn();
  reporter.cleanup = vi.fn();

  return {
    reporter,
    createProgressReporter: vi.fn(() => reporter),
    createSolveRuntime: vi.fn(() => ({
      engine: { name: "mock-engine" },
      runner: { name: "mock-runner" },
      judge: { name: "mock-judge" },
      plannerProvider: { name: "mock-planner" },
      llmConfig: { provider: "openrouter", model: "resolved-model" }
    })),
    solveProblem: vi.fn(),
    formatResult: vi.fn(() => "formatted result")
  };
});

vi.mock("../dist/io/formatter/progressReporter.js", () => ({
  createProgressReporter: mocks.createProgressReporter
}));

vi.mock("../dist/solve/runtime.js", () => ({
  createSolveRuntime: mocks.createSolveRuntime
}));

vi.mock("../dist/solve/solve.js", () => ({
  solveProblem: mocks.solveProblem
}));

vi.mock("../dist/io/formatter/formatResult.js", () => ({
  formatResult: mocks.formatResult
}));

import { runSolveCommand } from "../dist/cli/commands/solve.js";

describe("runSolveCommand", () => {
  const originalExitCode = process.exitCode;
  let stdoutWrite;

  beforeEach(() => {
    mocks.createProgressReporter.mockClear();
    mocks.createSolveRuntime.mockClear();
    mocks.solveProblem.mockReset();
    mocks.formatResult.mockClear();
    mocks.reporter.mockClear();
    mocks.reporter.cleanup.mockClear();
    process.exitCode = undefined;
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    process.exitCode = originalExitCode;
  });

  it("cleans up bar progress output after a failed solve", async () => {
    mocks.solveProblem.mockResolvedValue({
      finalCheck: { passed: false }
    });

    await runSolveCommand({
      problem: "sum",
      engine: "mock",
      runner: "docker",
      maxIter: 3,
      mode: "single",
      parallelism: 3,
      selector: "first-pass-wins",
      knowledge: "off",
      knowledgeModel: "test-model",
      knowledgeDataset: "data/knowledge/shellgei-basic.jsonl",
      progress: "bar"
    });

    expect(mocks.createProgressReporter).toHaveBeenCalledWith("bar");
    expect(mocks.solveProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        onProgress: mocks.reporter
      })
    );
    expect(mocks.reporter.cleanup).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).toHaveBeenCalledWith("formatted result\n");
    expect(process.exitCode).toBe(1);
  });

  it("cleans up bar progress output when solveProblem rejects", async () => {
    mocks.solveProblem.mockRejectedValue(new Error("boom"));

    await expect(
      runSolveCommand({
        problem: "sum",
        engine: "mock",
        runner: "docker",
        maxIter: 3,
          mode: "single",
          parallelism: 3,
          selector: "first-pass-wins",
          knowledge: "off",
          knowledgeModel: "test-model",
          knowledgeDataset: "data/knowledge/shellgei-basic.jsonl",
          progress: "bar"
        })
    ).rejects.toThrow("boom");

    expect(mocks.reporter.cleanup).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it("cleans up progress output when runtime configuration fails", async () => {
    mocks.createSolveRuntime.mockImplementationOnce(() => {
      throw new Error("Set OPENROUTER_API_KEY");
    });
    await expect(runSolveCommand({ problem: "sum", progress: "bar" }))
      .rejects.toThrow("Set OPENROUTER_API_KEY");
    expect(mocks.reporter.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.solveProblem).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it("forwards explicit LLM settings and shares resolved config and Planner with solve", async () => {
    mocks.solveProblem.mockResolvedValue({ finalCheck: { passed: true } });
    await runSolveCommand({
      problem: "sum", engine: "api", runner: "docker", progress: "off",
      llmBaseUrl: "https://api.openai.com/v1", llmModel: "worker", plannerModel: "planner",
      llmTimeout: 15000, llmMaxRetries: 0
    });
    expect(mocks.createSolveRuntime).toHaveBeenCalledWith({
      engine: "api", runner: "docker",
      llm: { baseURL: "https://api.openai.com/v1", model: "worker", plannerModel: "planner", timeoutMs: 15000, maxRetries: 0 }
    });
    const runtime = mocks.createSolveRuntime.mock.results[0].value;
    const solveOptions = mocks.solveProblem.mock.calls[0][0];
    expect(solveOptions.plannerProvider).toBe(runtime.plannerProvider);
    expect(solveOptions.llmConfig).toBe(runtime.llmConfig);
  });

  it("does not add LLM defaults that would override resolver environment settings", async () => {
    mocks.solveProblem.mockResolvedValue({ finalCheck: { passed: true } });
    await runSolveCommand({ problem: "sum", progress: "off" });
    expect(mocks.createSolveRuntime).toHaveBeenCalledWith({
      engine: undefined, runner: undefined,
      llm: { baseURL: undefined, model: undefined, plannerModel: undefined, timeoutMs: undefined, maxRetries: undefined }
    });
  });

  it("forwards and formats the normalized all knowledge mode", async () => {
    const result = {
      knowledgeMode: "all",
      plan: { knowledgeMode: "all" },
      finalCheck: { passed: true }
    };
    mocks.solveProblem.mockResolvedValue(result);

    await runSolveCommand({
      problem: "sum",
      engine: "mock",
      runner: "docker",
      maxIter: 1,
      mode: "single",
      parallelism: 4,
      selector: "best-score-wins",
      knowledge: "all",
      knowledgeModel: "test-model",
      knowledgeDataset: "data/knowledge/shellgei-basic.jsonl",
      progress: "off"
    });

    expect(mocks.solveProblem).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeMode: "all" })
    );
    expect(mocks.formatResult).toHaveBeenCalledWith(result);
    expect(stdoutWrite).toHaveBeenCalledWith("formatted result\n");
    expect(process.exitCode).toBe(0);
  });

  it("forwards read-only Docker devices to solveProblem", async () => {
    mocks.solveProblem.mockResolvedValue({ finalCheck: { passed: true } });

    await runSolveCommand({
      problem: "inspect devices",
      engine: "mock",
      runner: "docker",
      maxIter: 1,
      mode: "single",
      parallelism: 4,
      selector: "best-score-wins",
      knowledge: "off",
      knowledgeModel: "test-model",
      knowledgeDataset: "data/knowledge/shellgei-basic.jsonl",
      dockerDevicesReadonly: ["/dev/loop40", "/dev/loop41"],
      progress: "off"
    });

    expect(mocks.solveProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        dockerDevicesReadonly: ["/dev/loop40", "/dev/loop41"]
      })
    );
  });

  it("forwards the SQLite database without resolving a legacy vector file", async () => {
    mocks.solveProblem.mockResolvedValue({ finalCheck: { passed: true } });
    await runSolveCommand({problem: "sum", engine: "mock", runner: "docker", knowledge: "planner",
      knowledgeDb: "custom.sqlite", knowledgeDataset: "custom.jsonl", knowledgeModel: "custom-model", progress: "off"});
    expect(mocks.solveProblem).toHaveBeenCalledWith(expect.objectContaining({knowledgeDbPath: "custom.sqlite",
      knowledgeDatasetPath: "custom.jsonl", knowledgeModel: "custom-model", knowledgeMode: "planner"}));
    expect(mocks.solveProblem.mock.calls[0][0]).not.toHaveProperty("knowledgeVectorsPath");
  });
});
