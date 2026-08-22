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
  it("includes normalized read-only Docker devices in the result", async () => {
    const result = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "mock",
        generateCommand: async () => ({
          command: "printf 'ok\\n'",
          explanation: "Print ok."
        })
      },
      runner: {
        name: "docker",
        run: async () => ({
          stdout: "ok\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          aborted: false,
          durationMs: 1
        })
      },
      judge: new SimpleJudge(),
      maxIterations: 1,
      dockerDevicesReadonly: ["/dev/null"],
      plannerProvider: createTestPlannerProvider()
    });

    expect(result.runner.dockerDevicesReadonly).toEqual(["/dev/null"]);
  });

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

  it("does not attach knowledge hints when knowledge is off", async () => {
    const seenTasks = [];
    const result = await solveProblem({
      problemInput: "print 42",
      engine: {
        name: "mock",
        generateCommand: async ({ workerTask }) => {
          seenTasks.push(workerTask);
          return { command: "printf '42\\n'", explanation: "ok" };
        }
      },
      runner: {
        name: "mock",
        run: async () => ({
          stdout: "42\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 1
        })
      },
      judge: {
        judge: async () => ({
          passed: true,
          reason: "ok",
          score: { value: 100, breakdown: {} }
        })
      },
      maxIterations: 1,
      parallelism: 2,
      knowledgeMode: "off",
      plannerProvider: createTestPlannerProvider()
    });

    expect(result.finalCheck.passed).toBe(true);
    expect(seenTasks.length).toBeGreaterThan(0);
    expect(seenTasks.every((task) => !("knowledgeHints" in task))).toBe(true);
  });

  it("orchestrates one worker knowledge Tool call and logs only its bounded summary", async () => {
    const retrievedText = "RETRIEVED_TEXT_MUST_NOT_BE_LOGGED";
    const seenTasks = [];
    const search = vi.fn(async () => [
      {
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: retrievedText,
        source: "test",
        score: 0.9
      }
    ]);
    const generateTurn = vi.fn(async ({ context, continuation, toolResults }) => {
      seenTasks.push(context.workerTask);
      if (context.workerId !== "worker-1") {
        return { type: "command", command: "rm -rf /", explanation: "blocked worker" };
      }
      if (!continuation) {
        return {
          type: "tool_calls",
          calls: [
            {
              id: "call-1",
              name: "search_knowledge",
              arguments: { query: "  awk CSV fields  " }
            }
          ],
          continuation: { responseId: "response-1" }
        };
      }
      expect(toolResults).toEqual([
        {
          callId: "call-1",
          result: {
            ok: true,
            value: {
              records: [
                expect.objectContaining({ id: "man:awk:-F", text: retrievedText })
              ]
            }
          }
        }
      ]);
      return { type: "command", command: "printf '42\\n'", explanation: "Print 42." };
    });

    const result = await solveProblem({
      problemInput: "print 42",
      engine: {
        name: "tool-engine",
        capabilities: { toolCalling: true },
        generateTurn
      },
      runner: {
        name: "mock",
        run: async () => ({
          stdout: "42\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 1
        })
      },
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
      knowledgeRetriever: { search },
      plannerProvider: createTestPlannerProvider()
    });

    const expectedSummary = {
      name: "search_knowledge",
      arguments: { query: "awk CSV fields" },
      status: "completed",
      resultCount: 1,
      recordIds: ["man:awk:-F"]
    };
    expect(result.finalCheck.passed).toBe(true);
    expect(seenTasks.every((task) => !("knowledgeHints" in task))).toBe(true);
    expect(search).toHaveBeenCalledOnce();
    expect(result.attempts.find((attempt) => attempt.workerId === "worker-1")?.toolCalls).toEqual([
      expectedSummary
    ]);

    const logText = await readFile(result.logPath, "utf8");
    const logContent = JSON.parse(logText);
    expect(logContent.attempts.find((attempt) => attempt.workerId === "worker-1")?.toolCalls).toEqual([
      expectedSummary
    ]);
    expect(logText).not.toContain(retrievedText);
  });

  it("resets the one-call Tool budget for a retry after a continuation exceeds it", async () => {
    const search = vi.fn(async ({ query }) => [
      { id: `record:${query}`, command: "awk", text: "NEVER_LOG_RETRIEVED_TEXT", source: "test" }
    ]);
    const workerOneTurns = [];
    let workerOneTurn = 0;
    const generateTurn = vi.fn(async (request) => {
      const { context } = request;
      if (context.workerId !== "worker-1") {
        return { type: "command", command: "rm -rf /", explanation: "blocked worker" };
      }

      workerOneTurns.push({
        request,
        attemptCount: request.context.attempts.length
      });
      workerOneTurn += 1;
      if (workerOneTurn === 1) {
        return {
          type: "tool_calls",
          calls: [
            { id: "call-1", name: "search_knowledge", arguments: { query: "first" } }
          ],
          continuation: { responseId: "response-1" }
        };
      }
      if (workerOneTurn === 2) {
        return {
          type: "tool_calls",
          calls: [
            { id: "call-2", name: "search_knowledge", arguments: { query: "must-not-run" } }
          ],
          continuation: { responseId: "response-2" }
        };
      }
      if (workerOneTurn === 3) {
        return {
          type: "tool_calls",
          calls: [
            { id: "call-3", name: "search_knowledge", arguments: { query: "retry" } }
          ],
          continuation: { responseId: "response-3" }
        };
      }
      return { type: "command", command: "printf '42\\n'", explanation: "Recovered." };
    });

    const result = await solveProblem({
      problemInput: "print 42",
      engine: {
        name: "tool-engine",
        capabilities: { toolCalling: true },
        generateTurn
      },
      runner: {
        name: "mock",
        run: async () => ({
          stdout: "42\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 1
        })
      },
      judge: {
        judge: async () => ({
          passed: true,
          reason: "ok",
          score: { value: 100, breakdown: {} }
        })
      },
      maxIterations: 2,
      parallelism: 2,
      knowledgeMode: "worker",
      knowledgeRetriever: { search },
      plannerProvider: createTestPlannerProvider()
    });

    const workerAttempts = result.attempts.filter((attempt) => attempt.workerId === "worker-1");
    expect(workerAttempts).toHaveLength(2);
    expect(workerAttempts[0]).toMatchObject({
      command: "",
      passed: false,
      failureReason: "Worker Tool call limit exceeded.",
      toolCalls: [
        {
          arguments: { query: "first" },
          status: "completed",
          recordIds: ["record:first"]
        }
      ]
    });
    expect(workerAttempts[1]).toMatchObject({
      command: "printf '42\\n'",
      passed: true,
      toolCalls: [
        {
          arguments: { query: "retry" },
          status: "completed",
          recordIds: ["record:retry"]
        }
      ]
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).not.toHaveBeenCalledWith({ query: "must-not-run" });
    expect(workerOneTurns[2].request).not.toHaveProperty("continuation");
    expect(workerOneTurns[2].attemptCount).toBe(1);
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
