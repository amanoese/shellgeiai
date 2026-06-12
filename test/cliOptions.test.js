import { describe, expect, it } from "vitest";
import { createCliProgram, parseCliOptions } from "../src/cliOptions.js";

describe("parseCliOptions", () => {
  it("exports a CLI program with help text", () => {
    const program = createCliProgram();

    expect(program.helpInformation()).toContain("shellgeiai solve");
    expect(program.helpInformation()).toContain("--shellgei-score-mode");
  });

  it("parses solve options defaults", () => {
    expect(parseCliOptions(["solve", "CSV", "の", "3列目"])).toMatchObject({
      command: "solve",
      problem: "CSV の 3列目",
      engine: "openai",
      runner: "docker",
      maxIter: 3,
      mode: "single",
      parallelism: 1,
      selector: "first-pass-wins",
      shellgeiScoreMode: "standard",
      progress: "off"
    });
  });

  it("parses runtime wiring options including shellgei score mode", () => {
    expect(
      parseCliOptions([
        "solve",
        "sum",
        "--runner",
        "docker",
        "--mode",
        "parallel",
        "--parallelism",
        "2",
        "--selector",
        "best-score-wins",
        "--shellgei-score-mode",
        "practical",
        "--time-budget",
        "1500",
        "--command-policy",
        "./config/command-policy.json",
        "--sandbox-policy",
        "./config/sandbox-policy.json",
        "--progress",
        "jsonl"
      ])
    ).toEqual({
      command: "solve",
      problem: "sum",
      engine: "openai",
      runner: "docker",
      maxIter: 3,
      mode: "parallel",
      parallelism: 2,
      selector: "best-score-wins",
      shellgeiScoreMode: "practical",
      timeBudgetMs: 1500,
      commandPolicyPath: "./config/command-policy.json",
      sandboxPolicyPath: "./config/sandbox-policy.json",
      progress: "jsonl"
    });
  });

  it("parses check, replay, and logs options", () => {
    expect(
      parseCliOptions([
        "check",
        "printf",
        "'ok\\n'",
        "--runner",
        "docker",
        "--workdir",
        "./tmp",
        "--time-budget",
        "1200",
        "--problem",
        "print ok",
        "--expected-output",
        "ok"
      ])
    ).toEqual({
      command: "check",
      shellCommand: "printf 'ok\\n'",
      runner: "docker",
      workdir: "./tmp",
      problem: "print ok",
      expectedOutput: "ok",
      timeBudgetMs: 1200
    });

    expect(
      parseCliOptions(["replay", "--log", "./logs/solve-123.json", "--candidate-id", "worker-2"])
    ).toMatchObject({
      command: "replay",
      logPath: "./logs/solve-123.json",
      candidateId: "worker-2",
      runner: "docker"
    });

    expect(parseCliOptions(["logs", "show", "2026-06-12T12-00-00-000Z"])).toEqual({
      command: "logs-show",
      logRef: "2026-06-12T12-00-00-000Z"
    });
  });
});
