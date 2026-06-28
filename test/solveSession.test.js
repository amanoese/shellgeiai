import { describe, expect, it } from "vitest";
import { reportSessionPhase } from "../src/solve/session/progress.js";
import { createSolveSession } from "../src/solve/session/solveSession.js";
import { SESSION_PHASES } from "../src/solve/session/sessionPhases.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

describe("SESSION_PHASES", () => {
  it("defines ordered main solve phases", () => {
    expect(SESSION_PHASES).toEqual([
      "initializing",
      "problem-parsing",
      "planning",
      "executing",
      "selecting",
      "logging",
      "completed"
    ]);
  });
});

describe("progress helpers", () => {
  it("reports session-phase events with ordering metadata", () => {
    const events = [];
    const session = {
      sessionId: "session-1",
      onProgress: (event) => events.push(event)
    };

    reportSessionPhase(session, "planning", "Building execution plan.");

    expect(events).toEqual([
      {
        type: "session-phase",
        sessionId: "session-1",
        phase: "planning",
        phaseIndex: 3,
        phaseCount: 7,
        message: "Building execution plan."
      }
    ]);
  });
});

describe("createSolveSession", () => {
  it("defaults shellgei score mode standard", async () => {
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.shellgeiScoreMode).toBe("standard");
  });

  it("reports initializing, problem-parsing, planning while building a session", async () => {
    const events = [];

    await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider(),
      onProgress: (event) => events.push(event)
    });

    expect(
      events.filter((event) => event.type === "session-phase").map((event) => event.phase)
    ).toEqual(["initializing", "problem-parsing", "planning"]);
  });
});
