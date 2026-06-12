import { describe, expect, it } from "vitest";
import { scoreShellgeiCandidate } from "../src/core/shellgeiScorer.js";

describe("scoreShellgeiCandidate", () => {
  it("returns rubric-aligned breakdown for passing candidates", () => {
    const result = scoreShellgeiCandidate({
      command: "awk -F, '$3>10{sum+=$3} END{print sum}' sample.csv",
      explanation: "Use awk once instead of a longer pipeline.",
      finalCheck: { passed: true },
      attempts: [{ durationMs: 12, stdout: "42\n" }]
    });

    expect(result).toEqual({
      value: expect.any(Number),
      mode: "standard",
      breakdown: {
        conciseness: expect.any(Number),
        shellness: expect.any(Number),
        ingenuity: expect.any(Number),
        readability: expect.any(Number),
        robustness: expect.any(Number),
        artistry: expect.any(Number)
      },
      notes: expect.any(Array),
      penalties: expect.any(Array)
    });
  });

  it("returns null for non-passing candidates", () => {
    expect(
      scoreShellgeiCandidate({
        command: "printf 'x\\n'",
        finalCheck: { passed: false },
        attempts: []
      })
    ).toBeNull();
  });
});
