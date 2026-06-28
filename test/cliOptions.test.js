import { describe, expect, it } from "vitest";
import { createCliProgram, parseCliOptions } from "../src/cliOptions.js";

const DEFAULT_RURI_MODEL = "sirasagi62/ruri-v3-30m-ONNX";
const DEFAULT_RURI_VECTORS =
  "data/knowledge/shellgei-basic.vectors.sirasagi62.ruri-v3-30m-ONNX.json";

function withKnowledgeModelEnv(value, fn) {
  const original = process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
  if (value == null) {
    delete process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
  } else {
    process.env.SHELLGEIAI_KNOWLEDGE_MODEL = value;
  }

  try {
    fn();
  } finally {
    if (original == null) {
      delete process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
    } else {
      process.env.SHELLGEIAI_KNOWLEDGE_MODEL = original;
    }
  }
}

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
    expect(program.helpInformation()).toContain("shellgeiai knowledge search");
    expect(program.helpInformation()).not.toContain("shellgeiai check");
    expect(program.helpInformation()).not.toContain("shellgeiai replay");
    expect(program.helpInformation()).toContain("--shellgei-score-mode");
    expect(program.helpInformation()).toContain("--knowledge-model");
    expect(program.helpInformation()).toContain("--top-k");
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
      knowledgeModel: DEFAULT_RURI_MODEL,
      knowledgeDatasetPath: "data/knowledge/shellgei-basic.jsonl",
      knowledgeVectorsPath: DEFAULT_RURI_VECTORS,
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
      knowledgeModel: DEFAULT_RURI_MODEL,
      knowledgeDatasetPath: "data/knowledge/shellgei-basic.jsonl",
      knowledgeVectorsPath: DEFAULT_RURI_VECTORS,
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
      "--knowledge-model",
      "cli-model",
      "--knowledge-dataset",
      "data/knowledge/shellgei-basic.jsonl",
      "--knowledge-vectors",
      "data/knowledge/shellgei-basic.vectors.json"
      ])
    ).toMatchObject({
      knowledgeMode: "worker",
      knowledgeModel: "cli-model",
      knowledgeDatasetPath: "data/knowledge/shellgei-basic.jsonl",
      knowledgeVectorsPath: "data/knowledge/shellgei-basic.vectors.json"
    });
  });

  it("uses environment knowledge model for solve when no CLI model is provided", () => {
    withKnowledgeModelEnv("env-model", () => {
      expect(parseCliOptions(["solve", "print 42"])).toMatchObject({
        knowledgeModel: "env-model"
      });
    });
  });

  it("lets solve CLI knowledge model override environment model", () => {
    withKnowledgeModelEnv("env-model", () => {
      expect(
        parseCliOptions([
          "solve",
          "print 42",
          "--knowledge-model",
          "cli-model"
        ])
      ).toMatchObject({
        knowledgeModel: "cli-model",
        knowledgeVectorsPath:
          "data/knowledge/shellgei-basic.vectors.cli-model.json"
      });
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
