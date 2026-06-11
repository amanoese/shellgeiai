import { describe, expect, it } from "vitest";
import { calculateWorkerConcurrency, createWorkerTaskQueue } from "../src/core/orchestrator.js";

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
