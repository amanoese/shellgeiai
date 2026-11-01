import { describe, expect, it } from "vitest";
import { selectSolveOutcome } from "../src/solve/selection/selector.js";
import { calculateShellgeiScore } from "../src/solve/scoring/shellgeiScorer.js";

function scoredCandidate(candidateId, length, artistry, overrides = {}) {
  const { value, effectiveLength } = calculateShellgeiScore(length, artistry);
  return {
    candidateId, command: "echo ok".padEnd(length),
    shellgeiScore: { value, version: "length-artistry-v1", breakdown: { commandLength: length, artistry, effectiveLength } },
    finalCheck: { passed: true }, ...overrides
  };
}

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
          mode: "simple",
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
          mode: "simple",
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
        totalScore: 72,
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

  it("allows artistry to overcome three characters but never four", () => {
    const shortest = scoredCandidate("shortest", 20, 0);
    const artistic = scoredCandidate("artistic", 23, 100);
    const longer = scoredCandidate("longer", 24, 100);
    expect(selectSolveOutcome([shortest, artistic], "best-score-wins").selectedCandidate.candidateId).toBe("artistic");
    expect(selectSolveOutcome([shortest, longer], "best-score-wins").selectedCandidate.candidateId).toBe("shortest");
  });

  it("uses unrounded effective length even when displayed score values coincide", () => {
    const left = scoredCandidate("left", 20, 0);
    const right = scoredCandidate("right", 20, 0.1);
    left.shellgeiScore.value = right.shellgeiScore.value = 80.97;
    expect(selectSolveOutcome([left, right], "best-score-wins").selectedCandidate.candidateId).toBe("right");
  });

  it("ignores history, timing, Judge points, consensus and explanations in a passing tie", () => {
    const preferred = scoredCandidate("preferred", 20, 0, {
      command: "echo a".padEnd(20), selectedAttemptId: "chosen",
      attempts: [{ attemptId: "failed", durationMs: 500, stdout: "wrong" }, { attemptId: "chosen", durationMs: 999, stdout: "ok" }],
      finalCheck: { passed: true, iterations: 2, score: { value: 80 } }, explanation: "longer explanation", output: "other"
    });
    const other = scoredCandidate("other", 20, 0, {
      command: "echo z".padEnd(20), attempts: [{ durationMs: 1, stdout: "ok" }],
      finalCheck: { passed: true, iterations: 1, score: { value: 100 } }, explanation: "short", output: "ok"
    });
    const peer = { ...other, candidateId: "peer" };
    for (const candidates of [[preferred, other, peer], [peer, other, preferred]]) {
      const result = selectSolveOutcome(candidates, "best-score-wins");
      expect(result.selectedCandidate.candidateId).toBe("preferred");
      expect(result.metrics.totalScore).toBe(preferred.shellgeiScore.value);
      expect(result.metrics.selectedDurationMs).toBe(999);
      expect(result.metrics.totalDurationMs).toBe(1499);
    }
  });

  it("breaks identical-command ties by candidate ID and excludes failures", () => {
    const candidates = [
      scoredCandidate("failed", 7, 100, { finalCheck: { passed: false } }),
      scoredCandidate("worker-2", 20, 0), scoredCandidate("worker-1", 20, 0)
    ];
    expect(selectSolveOutcome(candidates, "best-score-wins").selectedCandidate.candidateId).toBe("worker-1");
  });

  it("prefers the shorter candidate when effective lengths are exactly equal", () => {
    const shorter = scoredCandidate("shorter", 20, 0, { command: "echo z".padEnd(20) });
    const longer = scoredCandidate("longer", 21, 100 / 3.5, { command: "echo a".padEnd(21) });
    expect(shorter.shellgeiScore.breakdown.effectiveLength).toBe(longer.shellgeiScore.breakdown.effectiveLength);
    expect(selectSolveOutcome([longer, shorter], "best-score-wins").selectedCandidate.candidateId).toBe("shorter");
  });

  it("preserves the existing fallback selection when every candidate fails", () => {
    const candidates = [
      { candidateId: "low", finalCheck: { passed: false, score: { value: 10 } } },
      { candidateId: "high", finalCheck: { passed: false, score: { value: 25 } } }
    ];
    expect(selectSolveOutcome(candidates, "best-score-wins").selectedCandidate.candidateId).toBe("high");
  });
});
