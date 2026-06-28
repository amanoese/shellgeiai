import { describe, expect, it } from "vitest";

import { scoreShellgeiCandidate } from "../src/solve/scoring/shellgeiScorer.js";

function passingCandidate(command, overrides = {}) {
  return {
    command,
    explanation: "test candidate",
    finalCheck: { passed: true, gate: { stderrAllowed: true } },
    attempts: [{ durationMs: 12, stdout: "42\n", stderr: "" }],
    ...overrides
  };
}

describe("scoreShellgeiCandidate", () => {
  it("uses simple mode by default and returns the rubric axes for passing candidates", async () => {
    const result = await scoreShellgeiCandidate(
      passingCandidate("awk -F, '$3>10{sum+=$3} END{print sum}' sample.csv")
    );

    expect(result).toEqual({
      value: expect.any(Number),
      mode: "simple",
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
    expect(result.value).toBe(
      Object.values(result.breakdown).reduce((sum, score) => sum + score, 0)
    );
  });

  it("returns null for non-passing candidates", async () => {
    expect(
      await scoreShellgeiCandidate({
        command: "printf 'x\\n'",
        finalCheck: { passed: false },
        attempts: []
      })
    ).toBeNull();
  });

  it("weights the same command differently by evaluation mode", async () => {
    const candidate = passingCandidate(
      "printf '%s\n' '{a: \"b\"}' | node -pe 'JSON.stringify(eval(`(${fs.readFileSync(0)})`))'"
    );

    const simple = await scoreShellgeiCandidate(candidate, { mode: "simple" });
    const artistry = await scoreShellgeiCandidate(candidate, { mode: "artistry" });
    const robustness = await scoreShellgeiCandidate(candidate, { mode: "robustness" });

    expect(simple.mode).toBe("simple");
    expect(artistry.mode).toBe("artistry");
    expect(robustness.mode).toBe("robustness");
    expect(artistry.breakdown.ingenuity).toBeGreaterThan(simple.breakdown.ingenuity);
    expect(robustness.breakdown.robustness).toBeGreaterThan(simple.breakdown.robustness);
  });

  it("rewards language one-liners when they work as stdin/stdout shell tools", async () => {
    const oneLiner = await scoreShellgeiCandidate(
      passingCandidate("printf '%s\n' 'a b' | perl -lane 'print $F[1]'"),
      { mode: "artistry" }
    );
    const launchedProgram = await scoreShellgeiCandidate(
      passingCandidate("python -c 'print(\"b\")'"),
      { mode: "artistry" }
    );

    expect(oneLiner.breakdown.shellness).toBeGreaterThan(
      launchedProgram.breakdown.shellness
    );
    expect(oneLiner.breakdown.artistry).toBeGreaterThan(
      launchedProgram.breakdown.artistry
    );
  });
});
