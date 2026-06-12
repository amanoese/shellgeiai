import { describe, expect, it } from "vitest";
import { SimpleJudge } from "../src/judge/simpleJudge.js";

describe("SimpleJudge", () => {
  it("passes successful output", async () => {
    const judge = new SimpleJudge();

    await expect(
      judge.judge({
        command: "printf '123\\n'",
        stdout: "123\n",
        stderr: "",
        exitCode: 0,
        timedOut: false
      })
    ).resolves.toEqual({
      passed: true,
      reason: "Basic checks passed.",
      score: {
        value: 100,
        breakdown: {
          correctness: 60,
          stdoutQuality: 15,
          stderrQuality: 10,
          expectedOutput: 15
        }
      },
      gate: {
        disqualified: false,
        stderrAllowed: true,
        expectedOutputMatched: true
      }
    });
  });

  it("accepts warning-only stderr and records the gate state", async () => {
    const judge = new SimpleJudge();

    await expect(
      judge.judge({
        command: "printf '123\\n'",
        stdout: "123\n",
        stderr: "warning: using fallback path\n",
        exitCode: 0,
        timedOut: false
      })
    ).resolves.toMatchObject({
      passed: true,
      gate: {
        disqualified: false,
        stderrAllowed: true,
        expectedOutputMatched: true
      }
    });
  });

  it("zeros only expected-output portion when stdout does not match", async () => {
    const judge = new SimpleJudge();

    await expect(
      judge.judge({
        command: "printf '124\\n'",
        stdout: "124\n",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        expectedOutput: "123"
      })
    ).resolves.toMatchObject({
      passed: false,
      reason: "Output did not match expected output.",
      score: {
        value: 25,
        breakdown: {
          correctness: 0,
          stdoutQuality: 15,
          stderrQuality: 10,
          expectedOutput: 0
        }
      },
      gate: {
        disqualified: true,
        stderrAllowed: true,
        expectedOutputMatched: false
      }
    });
  });

  it("returns a zero score when execution timed out", async () => {
    const judge = new SimpleJudge();

    await expect(
      judge.judge({
        command: "sleep 10",
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: true,
        expectedOutput: "done"
      })
    ).resolves.toMatchObject({
      passed: false,
      reason: "Command timed out.",
      score: {
        value: 0
      },
      gate: {
        disqualified: true,
        stderrAllowed: false,
        expectedOutputMatched: false
      }
    });
  });

  it("fails commands that only pass by producing stderr noise", async () => {
    const judge = new SimpleJudge();

    await expect(
      judge.judge({
        command: "awk 'BEGIN{print 42; print \"boom\" > \"/dev/stderr\"}'",
        stdout: "42\n",
        stderr: "boom\n",
        exitCode: 0,
        timedOut: false,
        expectedOutput: "42\n"
      })
    ).resolves.toMatchObject({
      passed: false,
      reason: "stderr was not empty.",
      gate: {
        disqualified: true,
        stderrAllowed: false,
        expectedOutputMatched: false
      }
    });
  });
});
