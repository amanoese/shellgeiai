import { describe, expect, it } from "vitest";
import {
  calculateShellgeiScore,
  countCommandCharacters,
  normalizeArtistry,
  scoreShellgeiCandidate
} from "../src/solve/scoring/shellgeiScorer.js";

function passingCandidate(command, overrides = {}) {
  return { command, finalCheck: { passed: true }, ...overrides };
}

describe("length/artistry formula", () => {
  it.each([
    [20, 80.97, 82.14, 83.33],
    [100, 49.14, 49.57, 50.00],
    [500, 16.57, 16.62, 16.67],
    [1000, 9.06, 9.08, 9.09]
  ])("matches the agreed score table at %i characters", (length, low, middle, high) => {
    for (const [artistry, expected] of [[0, low], [50, middle], [100, high]]) {
      expect(calculateShellgeiScore(length, artistry).value).toBeCloseTo(expected, 2);
    }
  });

  it.each([1, 20, 100, 1000, 1_000_000, 1_000_000_000])("allows three extra characters, never four, at length %i", length => {
    const shortest = calculateShellgeiScore(length, 0).value;
    expect(calculateShellgeiScore(length + 3, 100).value).toBeGreaterThan(shortest);
    expect(calculateShellgeiScore(length + 4, 100).value).toBeLessThan(shortest);
    for (const artistry of [0, 50, 100]) {
      const score = calculateShellgeiScore(length, artistry).value;
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(100);
      expect(Number.isFinite(score)).toBe(true);
      expect(calculateShellgeiScore(length + 1, artistry).value).toBeLessThan(score);
    }
  });

  it("prefers artistry at equal length and limits the one-character score change", () => {
    expect(calculateShellgeiScore(20, 100).value).toBeGreaterThan(calculateShellgeiScore(20, 0).value);
    expect(calculateShellgeiScore(20, 100).value - calculateShellgeiScore(21, 100).value).toBeLessThan(1);
  });

  it("normalizes fixed theoretical bounds, without using other candidates", () => {
    expect(normalizeArtistry(0.15, 0.1)).toBe(0);
    expect(normalizeArtistry(0.95, 0.95)).toBe(100);
    expect(normalizeArtistry(0.65, 0.425)).toBeCloseTo(50);
  });

  it("counts Unicode code points, including whitespace and combining marks", () => {
    expect(countCommandCharacters("日😀e\u0301 \n")).toBe(6);
    expect(countCommandCharacters("é")).toBe(1);
    expect(countCommandCharacters("e\u0301")).toBe(2);
    expect(countCommandCharacters("x".repeat(1_000_000))).toBe(1_000_000);
  });
});

describe("scoreShellgeiCandidate", () => {
  it("returns versioned static metrics and retains reference axes", async () => {
    const result = await scoreShellgeiCandidate(passingCandidate("printf '42\\n'"));
    expect(result).toEqual({
      value: expect.any(Number), version: "length-artistry-v1", mode: "simple",
      breakdown: { commandLength: 13, artistry: 0, effectiveLength: 16.5, shellness: 20, readability: 100 },
      notes: expect.any(Array), penalties: expect.any(Array)
    });
    expect(result.value).toBeCloseTo(85.8369098712);
  });

  it("preserves the existing feature rules at their maximum", async () => {
    const score = await scoreShellgeiCandidate(passingCandidate("printf x | sort | node -pe '$_'"));
    expect(score.breakdown.artistry).toBeCloseTo(100);
  });

  it("scores exact command text without trimming or Unicode normalization", async () => {
    const command = " printf '日😀' \n# e\u0301\n";
    const score = await scoreShellgeiCandidate(passingCandidate(command));
    expect(score.breakdown.commandLength).toBe(command.length - 1);
  });

  it("is independent of execution time, failures, Judge points, and explanations", async () => {
    const command = "printf '42\\n'";
    const original = await scoreShellgeiCandidate(passingCandidate(command, {
      attempts: [{ durationMs: 1, stdout: "42" }], explanation: "short"
    }));
    const retried = await scoreShellgeiCandidate(passingCandidate(command, {
      attempts: [{ durationMs: 99999, passed: false }, { durationMs: 99999, stdout: "42" }],
      finalCheck: { passed: true, score: { value: 80 } }, explanation: "different explanation"
    }));
    expect(retried).toEqual(original);
  });

  it.each(["simple", "artistry", "robustness"])("accepts legacy %s as a compatibility label only", async mode => {
    const candidate = passingCandidate("printf '42\\n' | sort");
    const score = await scoreShellgeiCandidate(candidate, { mode });
    const base = await scoreShellgeiCandidate(candidate);
    expect(score).toEqual({ ...base, mode });
  });

  it("does not reward adding a long redundant pipeline", async () => {
    const short = await scoreShellgeiCandidate(passingCandidate("printf 'ok\\n'"));
    const padded = await scoreShellgeiCandidate(passingCandidate("printf 'ok\\n' | sed s/ok/ok/"));
    expect(padded.breakdown.artistry).toBeGreaterThan(short.breakdown.artistry);
    expect(padded.value).toBeLessThan(short.value);
  });

  it.each([{}, { command: "echo 42" }, { command: "echo 42", finalCheck: { passed: false } },
    passingCandidate(""), passingCandidate(" \n\t"), passingCandidate(null)])("leaves non-passing/empty candidates unscored: %j", async candidate => {
    expect(await scoreShellgeiCandidate(candidate)).toBeNull();
  });
});
