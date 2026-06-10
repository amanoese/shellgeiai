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
    expect(result.reason).toBe(
      "Selected the passing candidate with the best score; total=115, judge=100, stdout-consistency=10, output-consensus=5, judge-breakdown=(correctness=60, stdout=15, stderr=10, expected=15)."
    );
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
  });
});
