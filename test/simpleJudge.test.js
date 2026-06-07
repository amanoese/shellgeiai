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
      reason: "Basic checks passed."
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
      reason: "Command exited with code 1."
    });
  });
});
