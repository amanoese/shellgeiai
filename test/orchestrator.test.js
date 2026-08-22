import { describe, expect, it, vi } from "vitest";
import {
  createAbortedAttempt,
  createGenerationFailedAttempt,
  createWorkerCandidate,
  createWorkerSummary
} from "../src/solve/worker/attemptFactory.js";
import { getRemainingBudgetMs, getWorkerStopReason } from "../src/solve/worker/stopReason.js";
import { calculateWorkerConcurrency, createWorkerTaskQueue } from "../src/solve/worker/taskQueue.js";
import { runWorkerAttempt } from "../src/solve/worker/attemptRunner.js";
import { createExecutionSummary } from "../src/solve/orchestration/executionSummary.js";
import { createExecutionControl } from "../src/solve/orchestration/executionControl.js";

describe("createExecutionSummary", () => {
  it("orders results by task order and counts failed workers", () => {
    const failedWorkerResult = {
      attempts: [{ attemptId: "failed-attempt" }],
      candidate: {
        workerId: "failed-worker",
        finalCheck: { passed: false }
      },
      workerSummary: { workerId: "failed-worker" }
    };
    const passedWorkerResult = {
      attempts: [{ attemptId: "passed-attempt" }],
      candidate: {
        workerId: "passed-worker",
        finalCheck: { passed: true }
      },
      workerSummary: { workerId: "passed-worker" }
    };

    const summary = createExecutionSummary({
      results: [failedWorkerResult, passedWorkerResult],
      taskOrder: new Map([
        ["passed-worker", 0],
        ["failed-worker", 1]
      ]),
      control: { stopReason: "done", passingCandidateId: "passed-worker" }
    });

    expect(summary.candidates.map((candidate) => candidate.workerId)).toEqual([
      "passed-worker",
      "failed-worker"
    ]);
    expect(summary.failedWorkerCount).toBe(1);
    expect(summary.stopReason).toBe("done");
  });
});

describe("createExecutionControl", () => {
  it("requestStop aborts workers except the passing candidate worker", () => {
    const workers = new Map([
      ["keep", { workerId: "keep", abortController: new AbortController() }],
      ["stop", { workerId: "stop", abortController: new AbortController() }]
    ]);
    const control = createExecutionControl({ selectorName: "first-pass-wins" }, workers);

    control.requestStop({
      reason: "passed",
      passingCandidateId: "keep",
      exceptWorkerId: "keep"
    });

    expect(workers.get("keep").abortController.signal.aborted).toBe(false);
    expect(workers.get("stop").abortController.signal.aborted).toBe(true);
    expect(control.stopReason).toBe("passed");

    control.dispose();
  });
});

describe("worker task executor imports", () => {
  it("keeps the compatibility export identical to the direct worker executor export", async () => {
    const direct = await import("../src/solve/worker/executeWorkerTask.js");
    const compat = await import("../src/solve/worker/taskExecutor.js");

    expect(compat.executeWorkerTask).toBe(direct.executeWorkerTask);
  });
});

describe("getWorkerStopReason", () => {
  it("returns time-budget reason and records it when deadline expired", () => {
    const control = {};
    const reason = getWorkerStopReason({ deadlineAtMs: Date.now() - 1 }, control);

    expect(reason).toBe("Stopped because the overall time budget was exhausted.");
    expect(control.stopReason).toBe("Stopped because the overall time budget was exhausted.");
  });
});

describe("getRemainingBudgetMs", () => {
  it("returns undefined when no deadline is configured", () => {
    expect(getRemainingBudgetMs({})).toBeUndefined();
  });

  it("returns a non-negative remaining budget for an active deadline", () => {
    expect(getRemainingBudgetMs({ deadlineAtMs: Date.now() + 1000 })).toBeGreaterThanOrEqual(0);
  });
});

describe("calculateWorkerConcurrency", () => {
  it("caps concurrency at the number of queued worker tasks", () => {
    expect(calculateWorkerConcurrency(2, 5)).toBe(2);
  });

  it("keeps at least one worker slot when there are no tasks", () => {
    expect(calculateWorkerConcurrency(0, 4)).toBe(1);
  });
});

describe("createWorkerTaskQueue", () => {
  it("returns queued tasks in the original order", () => {
    const queue = createWorkerTaskQueue([
      { workerId: "worker-1" },
      { workerId: "worker-2" }
    ]);

    expect(queue.size()).toBe(2);
    expect(queue.takeNext()).toEqual({ workerId: "worker-1" });
    expect(queue.size()).toBe(1);
    expect(queue.takeNext()).toEqual({ workerId: "worker-2" });
    expect(queue.takeNext()).toBeNull();
    expect(queue.isEmpty()).toBe(true);
  });
});

describe("worker attempt factory", () => {
  const task = {
    workerId: "worker-1",
    strategy: "default",
    strategyProfile: {
      name: "balanced-search",
      focus: "Try a direct shell one-liner."
    }
  };

  it("creates aborted attempt shape with runner metadata", () => {
    const attempt = createAbortedAttempt({
      task,
      iteration: 0,
      command: "printf '42\\n'",
      explanation: "Print the expected value.",
      reason: "Stopped because overall time budget was exhausted.",
      runResult: {
        stdout: "partial\n",
        stderr: "warning\n",
        exitCode: null,
        timedOut: true,
        aborted: true,
        durationMs: 123,
        failure: { message: "aborted" },
        cleanup: { killed: true }
      }
    });

    expect(attempt).toEqual({
      attemptId: "worker-1-attempt-1",
      workerId: "worker-1",
      command: "printf '42\\n'",
      stdout: "partial\n",
      stderr: "warning\n",
      exitCode: null,
      timedOut: true,
      aborted: true,
      passed: false,
      explanation: "Print the expected value.",
      failureReason: "Stopped because overall time budget was exhausted.",
      durationMs: 123,
      runnerFailure: { message: "aborted" },
      runnerCleanup: { killed: true },
      toolCalls: [],
      score: {
        value: 0,
        breakdown: {
          correctness: 0,
          stdoutQuality: 0,
          stderrQuality: 0,
          expectedOutput: 0
        }
      }
    });
  });

  it("creates a retryable generation-failed attempt with bounded Tool audit data", () => {
    const toolCalls = [
      {
        name: "search_knowledge",
        arguments: { query: "awk" },
        status: "completed",
        resultCount: 1,
        recordIds: ["man:awk"]
      }
    ];

    expect(
      createGenerationFailedAttempt({
        task,
        iteration: 0,
        reason: "Worker Tool call limit exceeded.",
        toolCalls
      })
    ).toEqual({
      attemptId: "worker-1-attempt-1",
      workerId: "worker-1",
      command: "",
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      aborted: false,
      passed: false,
      explanation: "",
      failureReason: "Worker Tool call limit exceeded.",
      durationMs: 0,
      runnerFailure: null,
      runnerCleanup: null,
      score: {
        value: 0,
        breakdown: {
          correctness: 0,
          stdoutQuality: 0,
          stderrQuality: 0,
          expectedOutput: 0
        }
      },
      state: "idle",
      stopReason: "",
      toolCalls
    });
  });

  it("creates worker candidate from final passing attempt", () => {
    const finalAttempt = {
      command: "printf 'ok\\n'",
      stdout: "ok\n",
      explanation: "Emit ok.",
      passed: true,
      failureReason: "Matches expected output.",
      score: { value: 100, breakdown: { correctness: 40 } }
    };

    const candidate = createWorkerCandidate({
      task,
      attempts: [finalAttempt],
      finalAttempt,
      finalReason: finalAttempt.failureReason,
      lastExplanation: "",
      engineName: "test-engine"
    });

    expect(candidate).toEqual({
      candidateId: "worker-1",
      workerId: "worker-1",
      strategy: "default",
      command: "printf 'ok\\n'",
      output: "ok",
      explanation: "Emit ok.",
      attempts: [finalAttempt],
      finalCheck: {
        passed: true,
        iterations: 1,
        engine: "test-engine",
        reason: "Matches expected output.",
        score: { value: 100, breakdown: { correctness: 40 } }
      }
    });
  });

  it("creates worker summary with strategy profile and reason", () => {
    const summary = createWorkerSummary({
      task,
      attempts: [{ attemptId: "worker-1-attempt-1" }],
      finalCheck: {
        passed: false,
        reason: "No successful attempt."
      },
      finalState: "stopped"
    });

    expect(summary).toEqual({
      workerId: "worker-1",
      strategy: "default",
      strategyProfile: task.strategyProfile,
      attemptCount: 1,
      passed: false,
      state: "stopped",
      reason: "No successful attempt."
    });
  });
});

describe("runWorkerAttempt", () => {
  it("forwards normalized read-only Docker devices to the runner", async () => {
    const runnerRun = vi.fn(async () => ({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      durationMs: 1
    }));
    const session = {
      problem: { problemText: "Print ok", expectedOutput: "ok" },
      workdir: "/tmp",
      commandPolicy: undefined,
      engine: {
        generateCommand: vi.fn(async () => ({
          command: "printf 'ok\\n'",
          explanation: "Print ok."
        }))
      },
      runner: { run: runnerRun },
      judge: {
        judge: vi.fn(async () => ({
          passed: true,
          reason: "ok",
          score: { value: 100, breakdown: {} }
        }))
      },
      runnerLimits: {},
      sandboxPolicy: { networkAccess: "off", filesystemScope: "workdir-only" },
      dockerDevicesReadonly: ["/dev/loop40", "/dev/loop41"],
      progressEvents: []
    };

    await runWorkerAttempt({
      session,
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
      control: {},
      workerState: { abortController: new AbortController() },
      iteration: 0,
      attempts: []
    });

    expect(runnerRun).toHaveBeenCalledWith(
      "printf 'ok\\n'",
      expect.objectContaining({
        dockerDevicesReadonly: ["/dev/loop40", "/dev/loop41"]
      })
    );
  });

  it("creates unsafe attempt and skips runner for blocked command", async () => {
    const task = {
      workerId: "worker-1",
      strategy: "default",
      maxAttempts: 1
    };
    const runnerRun = vi.fn();
    const session = {
      problem: {
        problemText: "List files",
        expectedOutput: ""
      },
      workdir: "/tmp",
      commandPolicy: undefined,
      engine: {
        generateCommand: vi.fn(async () => ({
          command: "rm -rf /",
          explanation: "Remove everything."
        }))
      },
      runner: {
        run: runnerRun
      },
      progressEvents: []
    };
    const workerState = {
      abortController: new AbortController()
    };

    const result = await runWorkerAttempt({
      session,
      task,
      control: {},
      workerState,
      iteration: 0,
      attempts: []
    });

    expect(result.attempt).toMatchObject({
      command: "rm -rf /",
      passed: false,
      failureReason: expect.stringContaining("Blocked")
    });
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("turns only Worker Tool loop failures into retryable generation attempts", async () => {
    const task = {
      workerId: "worker-1",
      strategy: "default",
      maxAttempts: 2
    };
    const toolResult = {
      ok: true,
      value: { records: [{ id: "man:awk", text: "do not log this" }] },
      validatedArguments: { query: "awk" }
    };
    const toolRegistry = {
      definitions: vi.fn(() => [{ name: "search_knowledge" }]),
      execute: vi.fn(async () => toolResult)
    };
    const engine = {
      generateTurn: vi
        .fn()
        .mockResolvedValueOnce({
          type: "tool_calls",
          calls: [
            { id: "call-1", name: "search_knowledge", arguments: { query: "awk" } }
          ],
          continuation: { responseId: "response-1" }
        })
        .mockResolvedValueOnce({
          type: "tool_calls",
          calls: [
            { id: "call-2", name: "search_knowledge", arguments: { query: "sed" } }
          ],
          continuation: { responseId: "response-2" }
        })
    };
    const runnerRun = vi.fn();
    const session = {
      problem: { problemText: "List files", expectedOutput: "" },
      workdir: "/tmp",
      commandPolicy: undefined,
      engine,
      toolRegistry,
      runner: { run: runnerRun },
      progressEvents: []
    };

    const result = await runWorkerAttempt({
      session,
      task,
      control: {},
      workerState: { abortController: new AbortController() },
      iteration: 0,
      attempts: []
    });

    expect(result).toMatchObject({
      state: "idle",
      stopReason: "",
      command: "",
      passed: false,
      reason: "Worker Tool call limit exceeded."
    });
    expect(result.attempt).toMatchObject({
      command: "",
      passed: false,
      failureReason: "Worker Tool call limit exceeded.",
      state: "idle",
      stopReason: "",
      toolCalls: [
        {
          name: "search_knowledge",
          arguments: { query: "awk" },
          status: "completed",
          resultCount: 1,
          recordIds: ["man:awk"]
        }
      ]
    });
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("preserves unrelated Engine generation exceptions", async () => {
    const providerError = new Error("provider unavailable");
    const session = {
      problem: { problemText: "List files", expectedOutput: "" },
      workdir: "/tmp",
      engine: { generateCommand: vi.fn(async () => { throw providerError; }) }
    };

    await expect(
      runWorkerAttempt({
        session,
        task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
        control: {},
        workerState: { abortController: new AbortController() },
        iteration: 0,
        attempts: []
      })
    ).rejects.toBe(providerError);
  });
});
