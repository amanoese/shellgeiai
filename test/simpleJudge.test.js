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
      }
    });
  });

  it("accepts warning-only stderr and still awards stderr quality points", async () => {
    const judge = new SimpleJudge();

    await expect(
      judge.judge({
        command: "printf '123\\n'",
        stdout: "123\n",
        stderr: "warning: using fallback path\n",
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
      }
    });
  });

  it("zeros only the expected-output portion when stdout does not match", async () => {
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
    ).resolves.toEqual({
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
    ).resolves.toEqual({
      passed: false,
      reason: "Command timed out.",
      score: {
        value: 0,
        breakdown: {
          correctness: 0,
          stdoutQuality: 0,
          stderrQuality: 0,
          expectedOutput: 0
        }
      }
    });
  });

  it("fails when the command exits non-zero", async () => {
    const judge = new SimpleJudge();

    await expect(
      judge.judge({
        command: "cat missing-file",
        stdout: "",
        stderr: "cat: missing-file: No such file or directory\n",
        exitCode: 1,
        timedOut: false
      })
    ).resolves.toEqual({
      passed: false,
      reason: "Command exited with code 1.",
      score: {
        value: 15,
        breakdown: {
          correctness: 0,
          stdoutQuality: 0,
          stderrQuality: 0,
          expectedOutput: 15
        }
      }
    });
  });

  it("fails when stderr contains a non-warning message even if stdout matched", async () => {
    const judge = new SimpleJudge();

    await expect(
      judge.judge({
        command: "printf '123\\n'",
        stdout: "123\n",
        stderr: "error: noisy output\n",
        exitCode: 0,
        timedOut: false,
        expectedOutput: "123"
      })
    ).resolves.toEqual({
      passed: false,
      reason: "stderr was not empty.",
      score: {
        value: 15,
        breakdown: {
          correctness: 0,
          stdoutQuality: 15,
          stderrQuality: 0,
          expectedOutput: 0
        }
      }
    });
  });
});
