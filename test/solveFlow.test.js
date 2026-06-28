import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgressReporter } from "../src/io/formatter/progressReporter.js";
import { formatResult } from "../src/io/formatter/formatResult.js";
import { solveProblem } from "../src/solve/solve.js";
import { SimpleJudge } from "../src/execution/judge/simpleJudge.js";
import { LocalRunner } from "../src/execution/runner/localRunner.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("solveProblem", () => {
  it("emits top-level session phases around solve lifecycle", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    const events = [];

    const result = await solveProblem({
      problemInput: "print 42",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "awk 'BEGIN{print 42}'",
            explanation: "print 42"
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
      plannerProvider: createTestPlannerProvider(),
      onProgress: (event) => events.push(event)
    });

    expect(result.finalCheck.passed).toBe(true);
    expect(
      events.filter((event) => event.type === "session-phase").map((event) => event.phase)
    ).toEqual([
      "initializing",
      "problem-parsing",
      "planning",
      "executing",
      "selecting",
      "logging",
      "completed"
    ]);
  });

  it("assigns rubric-aligned shellgei scores passing candidates", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);

    const result = await solveProblem({
      problemInput: "print 123",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "awk 'BEGIN{print 123}'",
            explanation: "Single awk pass."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 2,
      requestedWorkdir,
      plannerProvider: createTestPlannerProvider()
    });

    expect(result.command).toBe("awk 'BEGIN{print 123}'");
    expect(result.finalCheck.passed).toBe(true);
    expect(result.candidates[0].shellgeiScore).toEqual(
      expect.objectContaining({
          mode: "simple",
        breakdown: expect.objectContaining({
          conciseness: expect.any(Number),
          shellness: expect.any(Number)
        })
      })
    );
  });

  it("keeps selector metrics shellgei score data in saved log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    const commandsByWorker = new Map([
      ["worker-1", "awk 'BEGIN{print 111}'"],
      ["worker-2", "printf '111\\n'"]
    ]);

    const result = await solveProblem({
      problemInput: "print 111",
      engine: {
        name: "test-engine",
        async generateCommand({ workerId }) {
          return {
            command: commandsByWorker.get(workerId) ?? "awk 'BEGIN{print 111}'",
            explanation: `Generated for ${workerId}.`
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
      plannerProvider: createTestPlannerProvider(),
      parallelism: 2,
      mode: "parallel",
      selector: "shellgei-score"
    });

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));

    expect(result.selector).toEqual(
      expect.objectContaining({
        reason: expect.any(String),
        selectedCandidateId: expect.any(String),
        score: expect.any(Object),
        metrics: expect.any(Object)
      })
    );
    expect(logContent.selector).toEqual(
      expect.objectContaining({
        name: "shellgei-score",
        reason: expect.any(String),
        score: expect.any(Object),
        metrics: expect.any(Object)
      })
    );
    expect(logContent.candidates[0].shellgeiScore).toEqual(
      expect.objectContaining({
          mode: "simple",
        breakdown: expect.any(Object)
      })
    );
  });

  it("preserves assigned variants in solve result and log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);

    const result = await solveProblem({
      problemInput: "print 123",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf '123\\n'",
            explanation: "Return expected output."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
      plannerProvider: createTestPlannerProvider(),
      parallelism: 2,
      mode: "parallel"
    });

    expect(result.plan.workerTasks[0].assignedVariant).toEqual(
      expect.objectContaining({
        variantId: expect.any(String),
        approach: expect.any(String)
      })
    );

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));

    expect(logContent.plan.workerTasks[0].assignedVariant).toEqual(
      expect.objectContaining({
        variantId: expect.any(String),
        approach: expect.any(String)
      })
    );
  });

  it("keeps final formatted output while reporting session phases", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    const stderrWrite = vi.fn();
    const stdoutWrite = vi.fn();
    const reporter = createProgressReporter("plain", stderrWrite);

    const result = await solveProblem({
      problemInput: "print 7",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "awk 'BEGIN{print 7}'",
            explanation: "print 7"
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
      plannerProvider: createTestPlannerProvider(),
      onProgress: reporter
    });

    stdoutWrite(`${formatResult(result)}\n`);

    expect(stderrWrite.mock.calls.map(([line]) => line)).toContain(
      "[progress] phase 7/7 completed: Solve completed.\n"
    );
    expect(stdoutWrite.mock.calls[0][0]).toContain("COMMAND:");
    expect(stdoutWrite.mock.calls[0][0]).toContain("awk");
  });
});
