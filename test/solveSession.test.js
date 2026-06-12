import { describe, expect, it } from "vitest";
import { createSolveSession } from "../src/core/solveSession.js";

describe("createSolveSession", () => {
  it("defaults shellgei score mode to standard", async () => {
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1
    });

    expect(session.shellgeiScoreMode).toBe("standard");
  });
});
