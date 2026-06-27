import { describe, expect, it } from "vitest";

import { parseCliOptions } from "../src/cliOptions.js";
import { createSolveSession } from "../src/core/solveSession.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

describe("default parallelism", () => {
  it("defaults solve CLI options to three workers", () => {
    const options = parseCliOptions(["solve", "print 42"]);

    expect(options.parallelism).toBe(3);
  });

  it("defaults solve sessions to three workers", async () => {
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

    expect(session.parallelism).toBe(3);
  });
});
