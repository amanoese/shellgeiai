import { describe, expect, it } from "vitest";
import { scoreShellgeiCandidate } from "../src/core/shellgeiScorer.js";

describe("scoreShellgeiCandidate", () => {
  it("scores only passed candidates", () => {
    const result = scoreShellgeiCandidate({
      command: "awk -F, '{s+=$3} END{print s}' sample.csv",
      finalCheck: { passed: true },
      attempts: [{ durationMs: 12 }]
    });

    expect(result).toEqual({
      value: expect.any(Number),
      breakdown: {
        shortness: expect.any(Number),
        simplicity: expect.any(Number),
        speed: expect.any(Number)
      }
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
