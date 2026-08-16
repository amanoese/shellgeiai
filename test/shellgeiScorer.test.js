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

  it("scores conciseness by whole-command length instead of pipeline size", async () => {
    const shorterPipeline = await scoreShellgeiCandidate(
      passingCandidate(
        "seq 100001 100500 | factor | awk 'NF==2{print $2}' | head -10"
      )
    );
    const longerPackedCommand = await scoreShellgeiCandidate(
      passingCandidate(
        "awk 'BEGIN{N=101000;for(i=2;i<=N;i++)a[i]=1;for(i=2;i*i<=N;i++)if(a[i])for(j=i*i;j<=N;j+=i)a[j]=0;for(i=100001;i<=N;i++)if(a[i])print i}' | head -10"
      )
    );

    expect(shorterPipeline.breakdown.conciseness).toBe(19);
    expect(longerPackedCommand.breakdown.conciseness).toBe(18);
    expect(shorterPipeline.breakdown.conciseness).toBeGreaterThan(
      longerPackedCommand.breakdown.conciseness
    );
  });
});
