import { describe, expect, it, vi } from "vitest";
import {
  createAbortedAttempt,
  createWorkerCandidate,
  createWorkerSummary
} from "../src/worker/attemptFactory.js";
import { getRemainingBudgetMs, getWorkerStopReason } from "../src/worker/stopReason.js";
import { calculateWorkerConcurrency, createWorkerTaskQueue } from "../src/worker/taskQueue.js";
import { runWorkerAttempt } from "../src/worker/attemptRunner.js";
import { createExecutionSummary } from "../src/core/executionSummary.js";
import { createExecutionControl } from "../src/core/executionControl.js";

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
    const direct = await import("../src/worker/executeWorkerTask.js");
    const compat = await import("../src/worker/taskExecutor.js");

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
});
