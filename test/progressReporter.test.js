import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    logUpdateMocks.createLogUpdate.mockClear();
    logUpdateMocks.logUpdate.mockClear();
    logUpdateMocks.logUpdate.clear.mockClear();
    logUpdateMocks.logUpdate.done.mockClear();
  });

  it("formats plain progress messages stderr output", () => {
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

  it("formats session-phase events in plain mode", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("plain", write);

    reporter({
      type: "session-phase",
      sessionId: "session-1",
      phase: "planning",
      phaseIndex: 3,
      phaseCount: 7,
      message: "Building execution plan."
    });

    expect(write).toHaveBeenCalledWith(
      "[progress] phase 3/7 planning: Building execution plan.\n"
    );
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

  it("renders main solve phase bar and only shows worker details during executing", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("bar", write, { isTTY: true });

    reporter({
      type: "session-phase",
      sessionId: "session-4",
      phase: "planning",
      phaseIndex: 3,
      phaseCount: 7,
      message: "Building execution plan."
    });

    let frame = logUpdateMocks.logUpdate.mock.calls.at(-1)[0];
    expect(frame).toContain("Solve [");
    expect(frame).toContain("3/7 planning");
    expect(frame).toContain("message: Building execution plan.");
    expect(frame).not.toContain("Workers [");

    reporter({
      type: "session-phase",
      sessionId: "session-4",
      phase: "executing",
      phaseIndex: 4,
      phaseCount: 7,
      message: "Running worker tasks."
    });
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
      state: "running"
    });
    reporter({
      type: "attempt-started",
      sessionId: "session-4",
      workerId: "worker-1",
      iteration: 1,
      command: "awk 'BEGIN{print 1}'"
    });

    frame = logUpdateMocks.logUpdate.mock.calls.at(-1)[0];
    expect(frame).toContain("4/7 executing");
    expect(frame).toContain("Workers [");
    expect(frame).toContain("worker-1 [");
  });

  it("uses a writable stream for bar mode even when write callback is omitted", () => {
    createProgressReporter("bar", undefined, { isTTY: true });

    expect(logUpdateMocks.createLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ write: expect.any(Function) }),
      expect.objectContaining({ showCursor: false })
    );
  });

  it("renders bar progress snapshots clears them on cleanup", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("bar", write, { isTTY: true });

    reporter({
      type: "session-phase",
      sessionId: "session-4",
      phase: "executing",
      phaseIndex: 4,
      phaseCount: 7,
      message: "Running worker tasks."
    });
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
      strategy: "default",
      maxAttempts: 5
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
      stopReason: "Stopped after first passing candidate was produced.",
      selectedCandidateId: "worker-1"
    });

    expect(logUpdateMocks.createLogUpdate).toHaveBeenCalledTimes(1);
    expect(logUpdateMocks.createLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ write }),
      expect.objectContaining({ showCursor: false })
    );
    const lastFrame = logUpdateMocks.logUpdate.mock.calls.at(-1)[0];
    expect(lastFrame).toContain("Solve [");
    expect(lastFrame).toContain("Workers [");
    expect(lastFrame).toContain("1/4 done");
    expect(lastFrame).toContain("running:1");
    expect(lastFrame).toContain("planning:1");
    expect(lastFrame).toContain("passed:1");
    expect(lastFrame).toContain("worker-1 [############] passed: attempt(2/5)");
    expect(lastFrame).toContain("selected: worker-1");

    reporter.cleanup();

    expect(logUpdateMocks.logUpdate.clear).toHaveBeenCalledTimes(1);
    expect(logUpdateMocks.logUpdate.done).toHaveBeenCalledTimes(1);
  });

  it("falls back to plain output when bar mode is used without TTY", () => {
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

  it("includes failed worker counts in plain session summary", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("plain", write);

    reporter({
      type: "session-finished",
      sessionId: "session-3",
      attemptCount: 4,
      candidateCount: 2,
      failedWorkerCount: 1,
      stopReason: "Stopped after first passing candidate produced."
    });

    expect(write).toHaveBeenCalledWith(
      "[progress] session finished: attempts=4, candidates=2, failed-workers=1, stop=Stopped after first passing candidate produced.\n"
    );
  });

  it("returns no reporter when progress output is disabled", () => {
    expect(createProgressReporter("off")).toBeUndefined();
  });
});
