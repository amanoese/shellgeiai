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
      judge: { name: "mock-judge" }
    })),
    solveProblem: vi.fn(),
    formatResult: vi.fn(() => "formatted result")
  };
});

vi.mock("../src/io/formatter/progressReporter.js", () => ({
  createProgressReporter: mocks.createProgressReporter
}));

vi.mock("../src/core/runtime.js", () => ({
  createSolveRuntime: mocks.createSolveRuntime
}));

vi.mock("../src/core/solve.js", () => ({
  solveProblem: mocks.solveProblem
}));

vi.mock("../src/io/formatter/formatResult.js", () => ({
  formatResult: mocks.formatResult
}));

import { runSolveCommand } from "../src/cli/commands/solve.js";

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
        progress: "bar"
      })
    ).rejects.toThrow("boom");

    expect(mocks.reporter.cleanup).toHaveBeenCalledTimes(1);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
