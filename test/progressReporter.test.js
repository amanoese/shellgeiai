import { describe, expect, it, vi } from "vitest";

const logUpdateMocks = vi.hoisted(() => {
  const logUpdate = vi.fn();
  logUpdate.clear = vi.fn();
  logUpdate.done = vi.fn();

  return {
    logUpdate,
    createLogUpdate: vi.fn(() => logUpdate)
  };
});

vi.mock("log-update", () => ({
  createLogUpdate: logUpdateMocks.createLogUpdate
}));

import { createProgressReporter } from "../src/formatter/progressReporter.js";

describe("createProgressReporter", () => {
  it("formats plain progress messages for stderr output", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("plain", write);

    reporter({
      type: "worker-state",
      sessionId: "session-1",
      workerId: "worker-2",
      state: "running"
    });

    expect(write).toHaveBeenCalledWith("[progress] worker-2 state=running\n");
  });

  it("serializes jsonl progress messages", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("jsonl", write);

    reporter({
      type: "session-started",
      sessionId: "session-2",
      parallelism: 2,
      workerCount: 2
    });

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({
        type: "session-started",
        sessionId: "session-2",
        parallelism: 2,
        workerCount: 2
      })}\n`
    );
  });

  it("renders bar progress snapshots and clears them on cleanup", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("bar", write, { isTTY: true });

    reporter({
      type: "session-started",
      sessionId: "session-4",
      parallelism: 2,
      workerCount: 4
    });
    reporter({
      type: "worker-started",
      sessionId: "session-4",
      workerId: "worker-1",
      strategy: "default",
      maxAttempts: 5
    });
    reporter({
      type: "worker-state",
      sessionId: "session-4",
      workerId: "worker-1",
      state: "planning"
    });
    reporter({
      type: "attempt-started",
      sessionId: "session-4",
      workerId: "worker-1",
      iteration: 1,
      command: "printf 'ok\\n'"
    });
    reporter({
      type: "worker-state",
      sessionId: "session-4",
      workerId: "worker-1",
      state: "running"
    });
    reporter({
      type: "worker-started",
      sessionId: "session-4",
      workerId: "worker-2",
      strategy: "awk-first",
      maxAttempts: 5
    });
    reporter({
      type: "worker-state",
      sessionId: "session-4",
      workerId: "worker-2",
      state: "planning"
    });
    reporter({
      type: "attempt-started",
      sessionId: "session-4",
      workerId: "worker-2",
      iteration: 1,
      command: "printf 'ok\\n'"
    });
    reporter({
      type: "worker-state",
      sessionId: "session-4",
      workerId: "worker-2",
      state: "running"
    });
    reporter({
      type: "worker-started",
      sessionId: "session-4",
      workerId: "worker-3",
      strategy: "text-filter",
      maxAttempts: 5
    });
    reporter({
      type: "worker-state",
      sessionId: "session-4",
      workerId: "worker-3",
      state: "planning"
    });
    reporter({
      type: "attempt-started",
      sessionId: "session-4",
      workerId: "worker-1",
      iteration: 2,
      command: "printf 'ok\\n'"
    });
    reporter({
      type: "worker-state",
      sessionId: "session-4",
      workerId: "worker-1",
      state: "judging"
    });
    reporter({
      type: "worker-finished",
      sessionId: "session-4",
      workerId: "worker-1",
      passed: true,
      reason: "Basic checks passed."
    });
    reporter({
      type: "session-finished",
      sessionId: "session-4",
      attemptCount: 1,
      candidateCount: 1,
      failedWorkerCount: 0,
      stopReason: "Stopped after the first passing candidate was produced.",
      selectedCandidateId: "worker-1"
    });

    expect(logUpdateMocks.createLogUpdate).toHaveBeenCalledTimes(1);
    expect(logUpdateMocks.createLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        isTTY: true
      }),
      expect.objectContaining({
        showCursor: false
      })
    );
    const lastFrame = logUpdateMocks.logUpdate.mock.calls.at(-1)[0];
    expect(lastFrame).toContain("Workers [");
    expect(lastFrame).toContain("1/4 done");
    expect(lastFrame).toContain("running:1");
    expect(lastFrame).toContain("planning:1");
    expect(lastFrame).toContain("passed:1");
    expect(lastFrame).toContain("worker-1 [");
    expect(lastFrame).toContain("running: attempt(1/5)");
    expect(lastFrame).toContain("worker-2 [");
    expect(lastFrame).toContain("running: attempt(1/5)");
    expect(lastFrame).toContain("worker-3 [");
    expect(lastFrame).toContain("planning: attempt(1/5)");
    expect(lastFrame).toContain("worker-1 [############] passed: attempt(2/5)");
    expect(lastFrame).toContain("selected: worker-1");

    reporter.cleanup();

    expect(logUpdateMocks.logUpdate.clear).toHaveBeenCalledTimes(1);
    expect(logUpdateMocks.logUpdate.done).toHaveBeenCalledTimes(1);
  });

  it("falls back to plain output when bar mode is used without a TTY", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("bar", write, { isTTY: false });

    reporter({
      type: "worker-state",
      sessionId: "session-5",
      workerId: "worker-1",
      state: "running"
    });

    expect(write).toHaveBeenCalledWith("[progress] worker-1 state=running\n");
  });

  it("includes failed worker counts in the plain session summary", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("plain", write);

    reporter({
      type: "session-finished",
      sessionId: "session-3",
      attemptCount: 4,
      candidateCount: 2,
      failedWorkerCount: 1,
      stopReason: "Stopped after the first passing candidate was produced."
    });

    expect(write).toHaveBeenCalledWith(
      "[progress] session finished: attempts=4, candidates=2, failed-workers=1, stop=Stopped after the first passing candidate was produced.\n"
    );
  });

  it("returns no reporter when progress output is disabled", () => {
    expect(createProgressReporter("off")).toBeUndefined();
  });
});
