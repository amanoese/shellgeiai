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
          reason: "failed",
          score: {
            value: 0,
            breakdown: {
              correctness: 0,
              stdoutQuality: 0,
              stderrQuality: 0,
              expectedOutput: 0
            }
          }
        }
      },
      {
        candidateId: "worker-2",
        finalCheck: {
          passed: true,
          iterations: 1,
          engine: "mock",
          reason: "passed",
          score: {
            value: 100,
            breakdown: {
              correctness: 60,
              stdoutQuality: 15,
              stderrQuality: 10,
              expectedOutput: 15
            }
          }
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
          output: "123",
          command: "awk '{print $1}'",
          attempts: [{ durationMs: 50, stdout: "123\n" }],
          explanation: "Longer and slower.",
          finalCheck: {
            passed: true,
            iterations: 2,
            engine: "mock",
            reason: "passed",
            score: {
              value: 80,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 5,
                expectedOutput: 0
              }
            }
          }
        },
        {
          candidateId: "worker-2",
          output: "123",
          command: "cut -d, -f1",
          attempts: [{ durationMs: 10, stdout: "123\n" }],
          explanation: "Short and clean.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 100,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-2");
    expect(result.reason).toContain("Selected worker-2 as the best passing candidate");
    expect(result.reason).toContain("judge score (100 > 80)");
    expect(result.metrics).toEqual({
      totalScore: 115,
      judgeScore: 100,
      stdoutConsistency: 10,
      outputConsensus: 5,
      totalDurationMs: 10,
      iterationCount: 1,
      commandLength: "cut -d, -f1".length,
      explanationLength: "Short and clean.".length
    });
  });

  it("prefers candidates whose output is reproduced by another passing worker", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          output: "42",
          command: "printf '42\\n'",
          attempts: [{ durationMs: 5, stdout: "42\n" }],
          explanation: "First matching output.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 100,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          }
        },
        {
          candidateId: "worker-2",
          output: "99",
          command: "printf '99\\n'",
          attempts: [{ durationMs: 1, stdout: "99\n" }],
          explanation: "Fast but not corroborated.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 100,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          }
        },
        {
          candidateId: "worker-3",
          output: "42",
          command: "printf '42\\n'",
          attempts: [{ durationMs: 8, stdout: "42\n" }],
          explanation: "Second matching output.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 100,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-1");
    expect(result.metrics?.outputConsensus).toBe(5);
    expect(result.reason).toContain("Selected worker-1 as the best passing candidate");
  });

  it("penalizes candidates whose stdout changed across attempts", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          output: "stable",
          command: "printf 'stable\\n'",
          attempts: [
            { durationMs: 4, stdout: "old\n" },
            { durationMs: 4, stdout: "stable\n" }
          ],
          explanation: "Changed once before succeeding.",
          finalCheck: {
            passed: true,
            iterations: 2,
            engine: "mock",
            reason: "passed",
            score: {
              value: 100,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          }
        },
        {
          candidateId: "worker-2",
          output: "stable",
          command: "printf 'stable\\n'",
          attempts: [{ durationMs: 6, stdout: "stable\n" }],
          explanation: "Stable from the start.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 100,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-2");
    expect(result.metrics?.stdoutConsistency).toBe(10);
    expect(result.reason).toContain("stdout consistency (10 > 5)");
  });

  it("prefers the candidate with the higher externally supplied judge score even without consensus advantages", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          output: "alpha",
          command: "printf 'alpha\\n'",
          attempts: [{ durationMs: 2, stdout: "alpha\n" }],
          explanation: "Higher judge score from an external weighting policy.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 97,
              breakdown: {
                correctness: 60,
                stdoutQuality: 12,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          }
        },
        {
          candidateId: "worker-2",
          output: "beta",
          command: "printf 'beta\\n'",
          attempts: [{ durationMs: 1, stdout: "beta\n" }],
          explanation: "Lower judge score despite being slightly faster.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 88,
              breakdown: {
                correctness: 60,
                stdoutQuality: 8,
                stderrQuality: 10,
                expectedOutput: 10
              }
            }
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-1");
    expect(result.metrics).toEqual({
      totalScore: 107,
      judgeScore: 97,
      stdoutConsistency: 10,
      outputConsensus: 0,
      totalDurationMs: 2,
      iterationCount: 1,
      commandLength: "printf 'alpha\\n'".length,
      explanationLength: "Higher judge score from an external weighting policy.".length
    });
    expect(result.reason).toContain("judge score (97 > 88)");
  });

  it("prefers judge score over total score when the judge score conflicts with bonuses", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          output: "alpha",
          command: "printf 'alpha\\n'",
          attempts: [{ durationMs: 1, stdout: "alpha\n" }],
          explanation: "Higher judge score with fewer bonus points.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 90,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 5
              }
            }
          }
        },
        {
          candidateId: "worker-2",
          output: "beta",
          command: "printf 'beta\\n'",
          attempts: [{ durationMs: 1, stdout: "beta\n" }],
          explanation: "Lower judge score with more bonus points.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 88,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 3
              }
            }
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-1");
    expect(result.reason).toContain("judge score (90 > 88)");
  });

  it("falls back to the highest-scoring non-passing candidate when no candidate passed", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          output: "partial",
          command: "printf 'partial\\n'",
          attempts: [{ durationMs: 4, stdout: "partial\n" }],
          explanation: "Higher partial score.",
          finalCheck: {
            passed: false,
            iterations: 1,
            engine: "mock",
            reason: "wrong output",
            score: {
              value: 40,
              breakdown: {
                correctness: 0,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          }
        },
        {
          candidateId: "worker-2",
          output: "empty",
          command: "printf ''",
          attempts: [{ durationMs: 1, stdout: "" }],
          explanation: "Lower fallback score.",
          finalCheck: {
            passed: false,
            iterations: 1,
            engine: "mock",
            reason: "stdout was empty",
            score: {
              value: 15,
              breakdown: {
                correctness: 0,
                stdoutQuality: 0,
                stderrQuality: 0,
                expectedOutput: 15
              }
            }
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.selectedCandidate?.candidateId).toBe("worker-1");
    expect(result.reason).toContain("No passing candidate was found; selected worker-1 as the best fallback candidate");
    expect(result.reason).toContain("judge score (40 > 15)");
  });

  it("reports score details without a breakdown when the judge score came from an external scorer", () => {
    const result = selectSolveOutcome(
      [
        {
          candidateId: "worker-1",
          output: "42",
          command: "printf '42\\n'",
          attempts: [{ durationMs: 3, stdout: "42\n" }],
          explanation: "External scorer omitted a breakdown.",
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "mock",
            reason: "passed",
            score: {
              value: 91
            }
          }
        }
      ],
      "best-score-wins"
    );

    expect(result.reason).toContain("Selected worker-1 as the best passing candidate");
    expect(result.score).toEqual({ value: 91 });
  });
});
