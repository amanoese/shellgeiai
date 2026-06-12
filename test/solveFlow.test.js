import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { solveProblem } from "../src/core/solve.js";
import { SimpleJudge } from "../src/judge/simpleJudge.js";
import { LocalRunner } from "../src/runner/localRunner.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("solveProblem", () => {
  it("assigns rubric-aligned shellgei scores to passing candidates", async () => {
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
      requestedWorkdir
    });

    expect(result.command).toBe("awk 'BEGIN{print 123}'");
    expect(result.finalCheck.passed).toBe(true);
    expect(result.candidates[0].shellgeiScore).toEqual(
      expect.objectContaining({
        mode: "standard",
        breakdown: expect.objectContaining({
          conciseness: expect.any(Number),
          shellness: expect.any(Number)
        })
      })
    );
  });

  it("keeps selector metrics and shellgei score data in the saved log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    const commandsByWorker = new Map([
      ["worker-1", "awk 'BEGIN{print 111}'"],
      ["worker-2", "printf '123\\n'"]
    ]);

    const result = await solveProblem({
      problemInput: "print 123",
      engine: {
        name: "test-engine",
        async generateCommand(context) {
          return {
            command: commandsByWorker.get(context.workerId) ?? "printf '0\\n'",
            explanation: `Command for ${context.workerId ?? "worker"}.`
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      selector: "best-score-wins",
      maxIterations: 1,
      requestedWorkdir,
      parallelism: 2,
      mode: "parallel"
    });

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));

    expect(result.selector.name).toBe("best-score-wins");
    expect(logContent.selector).toEqual(
      expect.objectContaining({
        name: "best-score-wins",
        selectedCandidateId: expect.any(String),
        metrics: expect.objectContaining({
          totalScore: expect.any(Number),
          shellgeiScore: expect.any(Number),
          rubricBreakdown: expect.any(Object)
        })
      })
    );
    expect(logContent.candidates[0].shellgeiScore).toEqual(
      expect.objectContaining({
        mode: "standard",
        breakdown: expect.any(Object)
      })
    );
  });

  it("preserves assigned variants in the solve result and log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);

    const result = await solveProblem({
      problemInput: "print 123",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf '123\\n'",
            explanation: "Return the expected output."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
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
});
