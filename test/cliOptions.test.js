import { describe, expect, it } from "vitest";
import { parseCliOptions } from "../src/cliOptions.js";

describe("parseCliOptions", () => {
  it("parses solve options with defaults", () => {
    expect(parseCliOptions(["solve", "CSV", "の", "3列目"])).toEqual({
      command: "solve",
      problem: "CSV の 3列目",
      engine: "openai",
      runner: "local",
      maxIter: 3,
      mode: "single",
      parallelism: 1,
      selector: "first-pass-wins"
    });
  });

  it("parses explicit engine, max iterations, and workdir", () => {
    expect(parseCliOptions(["solve", "sum", "--engine", "mock", "--max-iter", "5", "--workdir", "./tmp"])).toEqual({
      command: "solve",
      problem: "sum",
      engine: "mock",
      runner: "local",
      maxIter: 5,
      workdir: "./tmp",
      mode: "single",
      parallelism: 1,
      selector: "first-pass-wins"
    });
  });

  it("parses hidden future-facing options for runtime wiring", () => {
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
        "--time-budget",
        "1500",
        "--command-policy",
        "./config/command-policy.json",
        "--sandbox-policy",
        "./config/sandbox-policy.json"
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
      timeBudgetMs: 1500,
      commandPolicyPath: "./config/command-policy.json",
      sandboxPolicyPath: "./config/sandbox-policy.json"
    });
  });

  it("rejects an invalid engine", () => {
    expect(() => parseCliOptions(["solve", "sum", "--engine", "bad-engine"])).toThrow(
      "Invalid --engine value. Use openai or mock."
    );
  });

  it("rejects an invalid runner", () => {
    expect(() => parseCliOptions(["solve", "sum", "--runner", "bad-runner"])).toThrow(
      "Invalid --runner value. Use local or docker."
    );
  });

  it("rejects a non-positive max iteration count", () => {
    expect(() => parseCliOptions(["solve", "sum", "--max-iter", "0"])).toThrow(
      "Invalid --max-iter value. Use a positive integer."
    );
  });

  it("rejects a non-positive time budget", () => {
    expect(() => parseCliOptions(["solve", "sum", "--time-budget", "0"])).toThrow(
      "Invalid --time-budget value. Use a positive integer."
    );
  });

  it("rejects an unsupported selector", () => {
    expect(() => parseCliOptions(["solve", "sum", "--selector", "score-based"])).toThrow(
      "Invalid --selector value. Use first-pass-wins or best-score-wins."
    );
  });

  it("rejects an unsupported mode", () => {
    expect(() => parseCliOptions(["solve", "sum", "--mode", "worker-pool"])).toThrow(
      "Invalid --mode value. Use single or parallel."
    );
  });
});
