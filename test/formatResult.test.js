import { describe, expect, it } from "vitest";
import { formatResult } from "../src/formatter/formatResult.js";

describe("formatResult", () => {
  it("includes selector score details and candidate summaries", () => {
    const output = formatResult({
      command: "printf '42\\n'",
      output: "42",
      explanation: "Prints the agreed answer.",
      finalCheck: {
        passed: true,
        iterations: 1,
        engine: "openai",
        reason: "Output matched expected output."
      },
      selector: {
        name: "best-score-wins",
        selectedCandidateId: "worker-2",
        reason: "Selected worker-2 as the best passing candidate after comparing it with worker-1; it won on judge score (100 > 95).",
        score: {
          value: 100,
          breakdown: {
            correctness: 60,
            stdoutQuality: 15,
            stderrQuality: 10,
            expectedOutput: 15
          }
        },
        metrics: {
          totalScore: 115,
          judgeScore: 100,
          stdoutConsistency: 10,
          outputConsensus: 5,
          totalDurationMs: 8,
          iterationCount: 1,
          commandLength: 12,
          explanationLength: 26
        }
      },
      runner: {
        name: "local",
        sandboxPolicy: {
          networkAccess: "off",
          filesystemScope: "workspace-write"
        }
      },
      stopReason: null,
      logPath: "/tmp/solve.json",
      candidates: [
        {
          candidateId: "worker-1",
          strategy: "default",
          finalCheck: {
            passed: true,
            iterations: 1,
            reason: "Output matched expected output.",
            score: {
              value: 95
            }
          }
        },
        {
          candidateId: "worker-2",
          strategy: "consensus",
          finalCheck: {
            passed: true,
            iterations: 1,
            reason: "Output matched expected output.",
            score: {
              value: 100
            }
          }
        }
      ]
    });

    expect(output).toContain("selected-score: 100");
    expect(output).toContain("score-breakdown: correctness=60, stdout=15, stderr=10, expected=15");
    expect(output).toContain(
      "selector-metrics: total=115, judge=100, stdout-consistency=10, output-consensus=5, duration-ms=8, iterations=1"
    );
    expect(output).toContain(
      "selector-reason: Selected worker-2 as the best passing candidate after comparing it with worker-1; it won on judge score (100 > 95)."
    );
    expect(output).toContain("worker-1: passed | strategy: default | iterations: 1 | score: 95");
    expect(output).toContain("worker-2: passed | strategy: consensus | iterations: 1 | score: 100");
  });
});
