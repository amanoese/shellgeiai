import { describe, expect, it } from "vitest";
import { selectSolveOutcome } from "../src/core/selector.js";

describe("selectSolveOutcome", () => {
  it("selects the first passing candidate", () => {
    const result = selectSolveOutcome([
      {
        candidateId: "worker-1",
        finalCheck: {
          passed: false,
          iterations: 1,
          engine: "mock",
          reason: "failed"
        }
      },
      {
        candidateId: "worker-2",
        finalCheck: {
          passed: true,
          iterations: 1,
          engine: "mock",
          reason: "passed"
        }
      }
    ]);

    expect(result.selectedCandidate?.candidateId).toBe("worker-2");
    expect(result.selector).toBe("first-pass-wins");
  });

  it("selects the best passing candidate when best-score-wins is requested", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          command: "awk '{print $1}'",
          attempts: [{ durationMs: 50 }],
          finalCheck: {
            passed: true,
            iterations: 2,
            engine: "mock",
            reason: "passed"
          }
        },
        {
          candidateId: "worker-2",
          command: "cut -d, -f1",
          attempts: [{ durationMs: 10 }],
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed"
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-2");
    expect(result.reason).toBe("Selected the passing candidate with the best score.");
  });
});
