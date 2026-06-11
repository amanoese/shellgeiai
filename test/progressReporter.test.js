import { describe, expect, it, vi } from "vitest";
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
