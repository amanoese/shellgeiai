import { describe, expect, it, vi } from "vitest";
import { createProgressReporter } from "../src/formatter/progressReporter.js";

describe("createProgressReporter", () => {
  it("formats plain progress messages for stderr output", () => {
    const write = vi.fn();
    const reporter = createProgressReporter("plain", write);

    reporter({
      type: "attempt-finished",
      sessionId: "session-1",
      workerId: "worker-2",
      iteration: 3,
      passed: false,
      reason: "Command timed out."
    });

    expect(write).toHaveBeenCalledWith("[progress] worker-2 attempt 3 failed: Command timed out.\n");
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

  it("returns no reporter when progress output is disabled", () => {
    expect(createProgressReporter("off")).toBeUndefined();
  });
});
