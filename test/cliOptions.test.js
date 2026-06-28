import { describe, expect, it } from "vitest";
import { createCliProgram, parseCliOptions } from "../src/cliOptions.js";

describe("parseCliOptions", () => {
  it("keeps legacy cliOptions exports stable", async () => {
    const legacy = await import("../src/cliOptions.js");
    const modern = await import("../src/cli/parseCliOptions.js");

    expect(legacy.parseCliOptions).toBe(modern.parseCliOptions);
    expect(legacy.createCliProgram).toBe(modern.createCliProgram);
  });

  it("exports CLI program help text", () => {
    const program = createCliProgram();

    expect(program.helpInformation()).toContain("shellgeiai solve");
    expect(program.helpInformation()).not.toContain("shellgeiai check");
    expect(program.helpInformation()).not.toContain("shellgeiai replay");
    expect(program.helpInformation()).toContain("--shellgei-score-mode");
    expect(program.helpInformation()).toContain("shellgeiai --help");
  });

  it("parses top-level and subcommand help requests", () => {
    expect(parseCliOptions(["--help"])).toEqual({
      command: "help"
    });

    expect(parseCliOptions(["solve", "--help"])).toEqual({
      command: "help",
      topic: "solve"
    });
  });

  it("parses solve options defaults", () => {
    expect(parseCliOptions(["solve", "CSV", "の", "3列目"])).toMatchObject({
      command: "solve",
      problem: "CSV の 3列目",
      engine: "openai",
      runner: "docker",
      maxIter: 3,
      mode: "single",
      parallelism: 4,
    selector: "best-score-wins",
    shellgeiScoreMode: "simple",
    knowledgeMode: "off",
    knowledgeDatasetPath: "data/knowledge/shellgei-basic.jsonl",
    knowledgeVectorsPath: "data/knowledge/shellgei-basic.vectors.json",
    progress: "bar"
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
        "robustness",
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
    shellgeiScoreMode: "robustness",
    knowledgeMode: "off",
    knowledgeDatasetPath: "data/knowledge/shellgei-basic.jsonl",
    knowledgeVectorsPath: "data/knowledge/shellgei-basic.vectors.json",
    timeBudgetMs: 1500,
      commandPolicyPath: "./config/command-policy.json",
      sandboxPolicyPath: "./config/sandbox-policy.json",
      progress: "jsonl"
    });
  });

  it("parses worker knowledge options", () => {
    expect(
      parseCliOptions([
        "solve",
        "CSV の 3列目",
      "--knowledge",
      "worker",
      "--knowledge-dataset",
      "data/knowledge/shellgei-basic.jsonl",
      "--knowledge-vectors",
      "data/knowledge/shellgei-basic.vectors.json"
      ])
  ).toMatchObject({
    knowledgeMode: "worker",
    knowledgeDatasetPath: "data/knowledge/shellgei-basic.jsonl",
    knowledgeVectorsPath: "data/knowledge/shellgei-basic.vectors.json"
  });
});

  it("rejects unknown knowledge mode", () => {
    expect(() =>
      parseCliOptions(["solve", "print 42", "--knowledge", "planner"])
    ).toThrow("Invalid --knowledge value. Use off or worker.");
  });

  it("rejects parallelism lower than two workers", () => {
    expect(() => parseCliOptions(["solve", "print 42", "--parallelism", "1"])).toThrow(
      "Invalid --parallelism value. Use integer 2 or greater."
    );
  });

  it("parses writable workdir flag for solve", () => {
    expect(parseCliOptions(["solve", "sum", "--writable-workdir"])).toMatchObject({
      command: "solve",
      problem: "sum",
      writableWorkdir: true
    });

  });

  it("parses logs commands", () => {
    expect(parseCliOptions(["logs", "show", "2026-06-12T12-00-00-000Z"])).toEqual({
      command: "logs-show",
      logRef: "2026-06-12T12-00-00-000Z"
    });
  });

  it("does not expose the removed check command", () => {
    expect(() => parseCliOptions(["check", "printf", "ok"])).toThrow("Unknown command: check");
  });

  it("does not expose the removed replay command", () => {
    expect(() => parseCliOptions(["replay", "--log", "./logs/solve-123.json"])).toThrow(
      "Unknown command: replay"
    );
  });
});
