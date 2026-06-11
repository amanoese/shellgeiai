import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { solveProblem } from "../src/core/solve.js";
import { SimpleJudge } from "../src/judge/simpleJudge.js";
import { DockerRunner } from "../src/runner/dockerRunner.js";
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
      reason: "Basic checks passed.",
      score: {
        value: 100,
        breakdown: {
          correctness: 60,
          stdoutQuality: 15,
          stderrQuality: 10,
          expectedOutput: 15
        }
      }
    });
    expect(result.selector).toEqual({
      name: "first-pass-wins",
      reason: "Selected the first candidate that passed final checks.",
      selectedCandidateId: "worker-1",
      score: {
        value: 100,
        breakdown: {
          correctness: 60,
          stdoutQuality: 15,
          stderrQuality: 10,
          expectedOutput: 15
        }
      },
      metrics: {
        totalScore: 110,
        judgeScore: 100,
        stdoutConsistency: 10,
        outputConsensus: 0,
        totalDurationMs: expect.any(Number),
        iterationCount: 1,
        commandLength: "printf '123\\n'".length,
        explanationLength: "Prints a known value.".length
      }
    });
    expect(result.plan).toEqual({
      mode: "single",
      parallelism: 1,
      workerTasks: [
        {
          workerId: "worker-1",
          strategy: "default",
          strategyProfile: {
            name: "balanced-search",
            focus: "Start with the most direct safe one-liner and keep the command shape simple.",
            retryHint: "Keep the command close to the previous attempt and adjust only the failing part."
          },
          maxAttempts: 2
        }
      ]
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.workerSummaries).toEqual([
      {
        workerId: "worker-1",
        strategy: "default",
        strategyProfile: {
          name: "balanced-search",
          focus: "Start with the most direct safe one-liner and keep the command shape simple.",
          retryHint: "Keep the command close to the previous attempt and adjust only the failing part."
        },
        attemptCount: 1,
        passed: true,
        state: "idle",
        reason: "Basic checks passed."
      }
    ]);

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.problem).toBe("print 123");
    expect(logContent.startedAt).toBeTypeOf("string");
    expect(logContent.finishedAt).toBeTypeOf("string");
    expect(logContent.workdir).toBe(requestedWorkdir);
    expect(logContent.attempts).toHaveLength(1);
    expect(logContent.candidates).toHaveLength(1);
    expect(logContent.workerSummaries).toEqual(result.workerSummaries);
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
    expect(result.selector.reason).toContain("best passing candidate");
    expect(result.selector.metrics?.totalScore).toBeGreaterThanOrEqual(110);
    expect(result.candidates.every((candidate) => candidate.finalCheck.score?.value === 100)).toBe(true);
  });

  it("re-judges the selected best-score candidate in the parent", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    let judgeCalls = 0;

    const judge = {
      async judge(input) {
        judgeCalls += 1;
        return await new SimpleJudge().judge(input);
      }
    };

    const result = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "test-engine",
        async generateCommand(context) {
          if (context.workerId === "worker-1") {
            return {
              command: "sleep 0.05; printf 'ok\\n'",
              explanation: "Slower candidate."
            };
          }

          return {
            command: "printf 'ok\\n'",
            explanation: "Faster candidate."
          };
        }
      },
      runner: new LocalRunner(),
      judge,
      maxIterations: 1,
      requestedWorkdir,
      parallelism: 2,
      selector: "best-score-wins"
    });

    expect(judgeCalls).toBe(3);
    expect(result.selector.name).toBe("best-score-wins");
    expect(result.finalCheck.passed).toBe(true);
    expect(result.finalCheck.reason).toBe("Basic checks passed.");
  });

  it("passes expected output parsed from the problem spec through to the judge and saved log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);

    const result = await solveProblem({
      problemInput: `expected_output:
ok
---
ok を出力してください`,
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf 'ok\\n'",
            explanation: "Prints the expected output."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir
    });

    expect(result.finalCheck.passed).toBe(true);
    expect(result.finalCheck.reason).toBe("Output matched expected output.");
    expect(result.problem).toEqual({
      raw: `expected_output:
ok
---
ok を出力してください`,
      problemText: "ok を出力してください",
      expectedOutput: "ok",
      metadata: {
        format: "plain-text+expected-output"
      }
    });

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.problemSpec.expectedOutput).toBe("ok");
    expect(logContent.problemSpec.problemText).toBe("ok を出力してください");
  });

  it("waits five seconds before aborting remaining workers after the first passing candidate is selected", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((callback, delay, ...args) =>
      originalSetTimeout(callback, Math.max(0, Math.ceil(Number(delay ?? 0) / 100)), ...args));
    globalThis.clearTimeout = ((handle) => originalClearTimeout(handle));

    try {
      const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
      tempDirs.push(requestedWorkdir);
      const commandsByWorker = new Map([
        ["worker-1", "printf 'ok\\n'"],
        ["worker-2", "sleep 4; printf 'later\\n'"],
        ["worker-3", "sleep 12; printf 'too-late\\n'"]
      ]);
      const stdoutByCommand = new Map([
        ["printf 'ok\\n'", "ok\n"],
        ["sleep 4; printf 'later\\n'", "later\n"],
        ["sleep 12; printf 'too-late\\n'", "too-late\n"]
      ]);
      const delaysByCommand = new Map([
        ["printf 'ok\\n'", 0],
        ["sleep 4; printf 'later\\n'", 4000],
        ["sleep 12; printf 'too-late\\n'", 12000]
      ]);
      let settled = false;

      const resultPromise = solveProblem({
        problemInput: "print quickly",
        engine: {
          name: "test-engine",
          async generateCommand(context) {
            return {
              command: commandsByWorker.get(context.workerId) ?? "printf 'fallback\\n'",
              explanation: `Generated for ${context.workerId}.`
            };
          }
        },
        runner: {
          name: "fake",
          async run(command, { signal }) {
            const delayMs = delaysByCommand.get(command) ?? 0;

            return await new Promise((resolve) => {
              const finish = (aborted = false) => {
                resolve({
                  stdout: aborted ? "" : stdoutByCommand.get(command) ?? "",
                  stderr: "",
                  exitCode: aborted ? null : 0,
                  timedOut: false,
                  aborted,
                  durationMs: aborted ? 5 : delayMs,
                  failure: null,
                  cleanup: null
                });
              };

              const timer = setTimeout(() => finish(false), delayMs);
              if (signal.aborted) {
                clearTimeout(timer);
                finish(true);
                return;
              }

              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  finish(true);
                },
                { once: true }
              );
            });
          }
        },
        judge: new SimpleJudge(),
        maxIterations: 1,
        requestedWorkdir,
        parallelism: 3,
        selector: "first-pass-wins"
      }).then((result) => {
        settled = true;
        return result;
      });

      await new Promise((resolve) => originalSetTimeout(resolve, 2));
      expect(settled).toBe(false);

      const result = await resultPromise;

      expect(settled).toBe(true);
      expect(result.finalCheck.passed).toBe(true);
      expect(result.selector).toEqual({
        name: "first-pass-wins",
        reason: "Selected the first candidate that passed final checks.",
        selectedCandidateId: "worker-1",
        score: {
          value: 100,
          breakdown: {
            correctness: 60,
            stdoutQuality: 15,
            stderrQuality: 10,
            expectedOutput: 15
          }
        },
        metrics: {
          totalScore: 110,
          judgeScore: 100,
          stdoutConsistency: 10,
          outputConsensus: 0,
          totalDurationMs: 0,
          iterationCount: 1,
          commandLength: "printf 'ok\\n'".length,
          explanationLength: "Generated for worker-1.".length
        }
      });
      expect(result.stopReason).toBe("Stopped after the first passing candidate was produced.");
      expect(result.candidates.map((candidate) => candidate.workerId)).toEqual([
        "worker-1",
        "worker-2",
        "worker-3"
      ]);
      expect(result.candidates[1].finalCheck).toMatchObject({
        passed: true,
        reason: "Basic checks passed."
      });
      expect(result.candidates[2].finalCheck).toMatchObject({
        passed: false,
        reason: "Stopped after the first passing candidate was produced."
      });
      expect(result.workerSummaries).toEqual([
        {
          workerId: "worker-1",
          strategy: "default",
          strategyProfile: {
            name: "balanced-search",
            focus: "Start with the most direct safe one-liner and keep the command shape simple.",
            retryHint: "Keep the command close to the previous attempt and adjust only the failing part."
          },
          attemptCount: 1,
          passed: true,
          state: "idle",
          reason: "Basic checks passed."
        },
        {
          workerId: "worker-2",
          strategy: "awk-first",
          strategyProfile: {
            name: "awk-centric",
            focus: "Prefer awk for column-oriented or record-oriented transformations.",
            retryHint: "Retry by refining field separators, filters, or print formatting before changing tools."
          },
          attemptCount: 1,
          passed: true,
          state: "idle",
          reason: "Basic checks passed."
        },
        {
          workerId: "worker-3",
          strategy: "text-filter",
          strategyProfile: {
            name: "filter-pipeline",
            focus: "Prefer grep, sed, tr, and shell pipelines for text filtering and selection.",
            retryHint: "Retry with a narrower pipeline when the first attempt is too broad."
          },
          attemptCount: 1,
          passed: false,
          state: "stopped",
          reason: "Stopped after the first passing candidate was produced."
        }
      ]);
      expect(result.attempts).toHaveLength(3);
      expect(result.attempts[2]).toMatchObject({
        workerId: "worker-3",
        passed: false,
        failureReason: "Stopped after the first passing candidate was produced."
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
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
    expect(result.workerSummaries).toEqual([
      {
        workerId: "worker-1",
        strategy: "default",
        strategyProfile: {
          name: "balanced-search",
          focus: "Start with the most direct safe one-liner and keep the command shape simple.",
          retryHint: "Keep the command close to the previous attempt and adjust only the failing part."
        },
        attemptCount: 1,
        passed: false,
        state: "stopped",
        reason: "Stopped because the overall time budget was exhausted."
      }
    ]);
  });

  it("emits progress events that external callers can display", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    const progressEvents = [];

    const result = await solveProblem({
      problemInput: "print once",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf 'ok\\n'",
            explanation: "Prints a passing value."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
      onProgress(event) {
        progressEvents.push(event);
      }
    });

    expect(result.finalCheck.passed).toBe(true);
    expect(progressEvents.map((event) => event.type)).toEqual([
      "session-started",
      "worker-started",
      "worker-state",
      "attempt-started",
      "worker-state",
      "worker-state",
      "attempt-finished",
      "worker-finished",
      "session-finished"
    ]);
    expect(progressEvents[0]).toMatchObject({
      type: "session-started",
      parallelism: 1,
      workerCount: 1
    });
    expect(progressEvents[2]).toMatchObject({
      type: "worker-state",
      workerId: "worker-1",
      state: "planning"
    });
    expect(progressEvents[3]).toMatchObject({
      type: "attempt-started",
      workerId: "worker-1",
      iteration: 1,
      command: "printf 'ok\\n'"
    });
    expect(progressEvents[4]).toMatchObject({
      type: "worker-state",
      workerId: "worker-1",
      state: "running"
    });
    expect(progressEvents[5]).toMatchObject({
      type: "worker-state",
      workerId: "worker-1",
      state: "judging"
    });
    expect(progressEvents[6]).toMatchObject({
      type: "attempt-finished",
      workerId: "worker-1",
      passed: true,
      reason: "Basic checks passed."
    });
    expect(progressEvents.at(-1)).toMatchObject({
      type: "session-finished",
      attemptCount: 1,
      candidateCount: 1,
      failedWorkerCount: 0,
      stopReason: "Stopped after the first passing candidate was produced.",
      selectedCandidateId: "worker-1"
    });
  });

  it("records docker runner metadata and failures in solve logs", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-test-"));
    tempDirs.push(requestedWorkdir);
    const dockerRunner = new DockerRunner({
      image: "shellgeiai:test"
    });
    const originalRun = dockerRunner.run.bind(dockerRunner);
    dockerRunner.run = async () => ({
      stdout: "",
      stderr: "docker: Error response from daemon: failed to remove container\n",
      exitCode: 125,
      timedOut: false,
      aborted: false,
      durationMs: 12,
      failure: {
        type: "container-cleanup-failed",
        message: "docker: Error response from daemon: failed to remove container"
      },
      cleanup: {
        attempted: true,
        exitCode: 1,
        stderr: "docker: Error response from daemon: failed to remove container\n"
      },
      image: "shellgeiai:test"
    });

    const result = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf 'ok\\n'",
            explanation: "Print ok."
          };
        }
      },
      runner: dockerRunner,
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir
    });

    expect(result.runner.name).toBe("docker");
    expect(result.runner.image).toBe("shellgeiai:test");
    expect(result.attempts[0].runnerFailure).toEqual({
      type: "container-cleanup-failed",
      message: "docker: Error response from daemon: failed to remove container"
    });
    expect(result.attempts[0].runnerCleanup).toEqual({
      attempted: true,
      exitCode: 1,
      stderr: "docker: Error response from daemon: failed to remove container\n"
    });

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.runner.name).toBe("docker");
    expect(logContent.runner.image).toBe("shellgeiai:test");
    expect(logContent.attempts[0].runnerFailure).toEqual({
      type: "container-cleanup-failed",
      message: "docker: Error response from daemon: failed to remove container"
    });
    expect(logContent.attempts[0].runnerCleanup).toEqual({
      attempted: true,
      exitCode: 1,
      stderr: "docker: Error response from daemon: failed to remove container\n"
    });

    dockerRunner.run = originalRun;
  });
});
