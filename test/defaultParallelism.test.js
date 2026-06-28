import { describe, expect, it } from "vitest";

import { createSolveSession } from "../src/solve/session/solveSession.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

describe("default parallelism", () => {
  it("defaults solve sessions to four workers", async () => {
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: {
        name: "mock",
        generateCommand: async () => ({ command: "printf '42\\n'" })
      },
      runner: { name: "mock" },
      judge: {
        judge: async () => ({
          passed: true,
          reason: "ok",
          score: { value: 100, breakdown: {} }
        })
      },
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.parallelism).toBe(4);
  });
});
