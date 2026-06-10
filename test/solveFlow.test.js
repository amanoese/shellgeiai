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
  it("preserves the single-worker solve flow while writing a session log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);

    const result = await solveProblem({
      problemInput: "print 123",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf '123\\n'",
            explanation: "Prints a known value."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 2,
      requestedWorkdir
    });

    expect(result.command).toBe("printf '123\\n'");
    expect(result.output).toBe("123");
    expect(result.finalCheck).toEqual({
      passed: true,
      iterations: 1,
      engine: "test-engine",
      reason: "Basic checks passed."
    });
    expect(result.selector).toEqual({
      name: "first-pass-wins",
      reason: "Selected the first candidate that passed final checks.",
      selectedCandidateId: "worker-1"
    });
    expect(result.plan).toEqual({
      mode: "single",
      parallelism: 1,
      workerTasks: [
        {
          workerId: "worker-1",
          strategy: "default",
          maxAttempts: 2
        }
      ]
    });
    expect(result.candidates).toHaveLength(1);

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.problem).toBe("print 123");
    expect(logContent.startedAt).toBeTypeOf("string");
    expect(logContent.finishedAt).toBeTypeOf("string");
    expect(logContent.workdir).toBe(requestedWorkdir);
    expect(logContent.attempts).toHaveLength(1);
    expect(logContent.candidates).toHaveLength(1);
    expect(logContent.runner.limits.wallClockMs).toBe(5_000);
    expect(logContent.runner.limits.memoryMaxBytes).toBe(256 * 1024 * 1024);
    expect(logContent.runner.name).toBe("local");
  });

  it("creates multiple worker candidates when parallelism is greater than one", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);

    const commandsByWorker = new Map([
      ["worker-1", "printf '111\\n'"],
      ["worker-2", "printf '222\\n'"]
    ]);

    const result = await solveProblem({
      problemInput: "print some value",
      engine: {
        name: "test-engine",
        async generateCommand(context) {
          return {
            command: commandsByWorker.get(context.workerId) ?? "printf '000\\n'",
            explanation: `Generated for ${context.workerId} with ${context.strategy}.`
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
      parallelism: 2,
      selector: "best-score-wins"
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.workerId)).toEqual(["worker-1", "worker-2"]);
    expect(result.selector.name).toBe("best-score-wins");
    expect(result.selector.selectedCandidateId).toBeTypeOf("string");
  });

  it("stops additional worker iterations after the first passing candidate when first-pass-wins is used", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    const callsByWorker = new Map();

    const result = await solveProblem({
      problemInput: "print quickly",
      engine: {
        name: "test-engine",
        async generateCommand(context) {
          const currentCalls = callsByWorker.get(context.workerId) ?? 0;
          callsByWorker.set(context.workerId, currentCalls + 1);

          if (context.workerId === "worker-1") {
            return {
              command: "printf 'ok\\n'",
              explanation: "Succeeds immediately."
            };
          }

          return {
            command: "sleep 0.05; printf ''",
            explanation: "Fails once, then should be stopped."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 3,
      requestedWorkdir,
      parallelism: 2,
      selector: "first-pass-wins"
    });

    expect(result.finalCheck.passed).toBe(true);
    expect(callsByWorker.get("worker-1")).toBe(1);
    expect(callsByWorker.get("worker-2")).toBe(1);
    expect(result.stopReason).toBe("Stopped after the first passing candidate was produced.");
    expect(result.candidates[1].finalCheck.reason).toContain("worker-1");
  });

  it("aborts in-flight worker commands after the first passing candidate is selected", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);

    const result = await solveProblem({
      problemInput: "finish fast",
      engine: {
        name: "test-engine",
        async generateCommand(context) {
          if (context.workerId === "worker-1") {
            return {
              command: "printf 'ok\\n'",
              explanation: "Succeeds immediately."
            };
          }

          return {
            command: "sleep 1; printf 'late\\n'",
            explanation: "Should be aborted by the orchestrator."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
      parallelism: 2,
      selector: "first-pass-wins"
    });

    const abortedAttempt = result.attempts.find((attempt) => attempt.workerId === "worker-2");
    expect(abortedAttempt?.failureReason).toContain("worker-1");
    expect(abortedAttempt?.timedOut).toBe(false);
    expect(result.stopReason).toBe("Stopped after the first passing candidate was produced.");
  });

  it("respects the overall time budget across iterations", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    let callCount = 0;

    const result = await solveProblem({
      problemInput: "print eventually",
      engine: {
        name: "test-engine",
        async generateCommand() {
          callCount += 1;
          return {
            command: "sleep 0.05; printf 'late\\n'",
            explanation: "Needs longer than the allotted budget."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 3,
      requestedWorkdir,
      timeBudgetMs: 20
    });

    expect(result.finalCheck.passed).toBe(false);
    expect(result.finalCheck.reason).toContain("time budget");
    expect(result.attempts).toHaveLength(1);
    expect(callCount).toBe(1);
    expect(result.stopReason).toBe("Stopped because the overall time budget was exhausted.");
  });
});
