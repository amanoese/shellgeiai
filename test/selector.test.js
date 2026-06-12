import { describe, expect, it } from "vitest";
import { selectSolveOutcome } from "../src/core/selector.js";

describe("selectSolveOutcome", () => {
  it("selects the first passing candidate in first-pass mode", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          finalCheck: {
            passed: false,
            iterations: 1,
            engine: "mock",
            reason: "failed",
            score: { value: 0, breakdown: {} }
          }
        },
        {
          candidateId: "worker-2",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: { value: 100, breakdown: {} }
          }
        }
      ],
      "first-pass-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-2");
    expect(result.selector).toBe("first-pass-wins");
  });

  it("prefers passing candidate with higher shellgei score and returns rubric metrics", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          output: "123",
          command: "printf '123\\n'",
          shellgeiScore: {
            value: 72,
            mode: "standard",
            breakdown: {
              conciseness: 13,
              shellness: 14,
              ingenuity: 12,
              readability: 11,
              robustness: 12,
              artistry: 10
            },
            notes: ["Uses single awk pass"],
            penalties: []
          },
          attempts: [{ durationMs: 12, stdout: "123\n" }],
          explanation: "Shorter and cleaner.",
          finalCheck: {
            passed: true,
            iterations: 2,
            engine: "mock",
            reason: "passed",
            score: { value: 80, breakdown: {} }
          }
        },
        {
          candidateId: "worker-2",
          output: "123",
          command: "cat sample.csv | awk -F, '{print $3}'",
          shellgeiScore: {
            value: 60,
            mode: "standard",
            breakdown: {
              conciseness: 9,
              shellness: 12,
              ingenuity: 10,
              readability: 10,
              robustness: 11,
              artistry: 8
            },
            notes: [],
            penalties: ["Avoid useless use of cat."]
          },
          attempts: [{ durationMs: 12, stdout: "123\n" }],
          explanation: "Longer slower.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: { value: 100, breakdown: {} }
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-1");
    expect(result.reason).toContain("won on shellgei score");
    expect(result.metrics).toEqual(
      expect.objectContaining({
        totalScore: expect.any(Number),
        shellgeiScore: 72,
        rubricBreakdown: expect.objectContaining({
          conciseness: 13,
          shellness: 14
        }),
        judgeScore: 80,
        stdoutConsistency: 10,
        outputConsensus: 5,
        totalDurationMs: 12,
        iterationCount: 2,
        commandLength: "printf '123\\n'".length,
        explanationLength: "Shorter and cleaner.".length
      })
    );
  });
});
