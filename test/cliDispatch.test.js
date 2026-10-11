import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({
  runLogsListCommand: vi.fn(),
  runLogsPruneCommand: vi.fn(),
  runLogsSearchCommand: vi.fn(),
  runLogsShowCommand: vi.fn(),
  runKnowledgeBuildCommand: vi.fn(),
  runKnowledgeManCommand: vi.fn(),
  runKnowledgePrepareCommand: vi.fn(),
  runKnowledgeSearchCommand: vi.fn(),
  runSolveCommand: vi.fn()
}));

vi.mock("../src/cli/commands/logsList.js", () => ({
  runLogsListCommand: commands.runLogsListCommand
}));
vi.mock("../src/cli/commands/logsPrune.js", () => ({
  runLogsPruneCommand: commands.runLogsPruneCommand
}));
vi.mock("../src/cli/commands/logsSearch.js", () => ({
  runLogsSearchCommand: commands.runLogsSearchCommand
}));
vi.mock("../src/cli/commands/logsShow.js", () => ({
  runLogsShowCommand: commands.runLogsShowCommand
}));
vi.mock("../src/cli/commands/knowledge.js", () => ({
  runKnowledgeBuildCommand: commands.runKnowledgeBuildCommand,
  runKnowledgeManCommand: commands.runKnowledgeManCommand,
  runKnowledgePrepareCommand: commands.runKnowledgePrepareCommand,
  runKnowledgeSearchCommand: commands.runKnowledgeSearchCommand
}));
vi.mock("../src/cli/commands/solve.js", () => ({
  runSolveCommand: commands.runSolveCommand
}));

import { runCli } from "../src/cli/index.js";

function withKnowledgeModelEnv(value, fn) {
  const original = process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
  if (value == null) {
    delete process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
  } else {
    process.env.SHELLGEIAI_KNOWLEDGE_MODEL = value;
  }

  try {
    return fn();
  } finally {
    if (original == null) {
      delete process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
    } else {
      process.env.SHELLGEIAI_KNOWLEDGE_MODEL = original;
    }
  }
}

describe("runCli", () => {
  beforeEach(() => {
    for (const command of Object.values(commands)) {
      command.mockReset();
      command.mockResolvedValue(undefined);
    }
    process.exitCode = undefined;
  });

  it("dispatches solve with Commander defaults", async () => {
    await runCli(["solve", "print 42"]);

    expect(commands.runSolveCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        problem: "print 42",
        engine: "openai",
        runner: "docker",
        maxIter: 3,
        mode: "single",
        parallelism: 4,
        selector: "best-score-wins",
        shellgeiScoreMode: "simple",
        knowledge: "off",
        progress: "bar"
      })
    );
  });

  it("collects both read-only Docker device option spellings in order", async () => {
    await runCli([
      "solve",
      "inspect devices",
      "--device-ro",
      "/dev/loop40",
      "--docker-device-readonly",
      "/dev/loop41",
      "--device-ro",
      "/dev/loop42"
    ]);

    expect(commands.runSolveCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        dockerDevicesReadonly: ["/dev/loop40", "/dev/loop41", "/dev/loop42"]
      })
    );
  });

  it.each(["planner", "worker", "all", "on"])(
    "dispatches solve with %s knowledge mode",
    async (knowledge) => {
      await runCli(["solve", "print 42", "--knowledge", knowledge]);

      expect(commands.runSolveCommand).toHaveBeenCalledWith(
        expect.objectContaining({ knowledge: knowledge === "on" ? "all" : knowledge })
      );
    }
  );

  it("reports the exact error for an invalid knowledge mode", async () => {
    let errorOutput = "";
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((text) => {
        errorOutput += text;
        return true;
      });

    try {
      await runCli(["solve", "print 42", "--knowledge", "invalid"]);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(errorOutput).toContain(
      "Invalid --knowledge value. Use off, planner, worker, all, or on."
    );
  });

  it("lets solve CLI knowledge model override the environment model", async () => {
    await withKnowledgeModelEnv("env-model", () =>
      runCli(["solve", "print 42", "--knowledge-model", "cli-model"])
    );

    expect(commands.runSolveCommand).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeModel: "cli-model" })
    );
  });

  it("dispatches knowledge build with environment-backed model", async () => {
    await withKnowledgeModelEnv("env-model", () =>
      runCli(["knowledge", "build", "--dataset", "custom.jsonl"])
    );

    expect(commands.runKnowledgeBuildCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: "custom.jsonl",
        knowledgeModel: "env-model"
      })
    );
  });

  it("dispatches build database, batching and force options", async () => {
    await runCli([
      "knowledge", "build", "--db", "custom.sqlite", "--batch-size", "64",
      "--force", "--model", "alias-model"
    ]);
    expect(commands.runKnowledgeBuildCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        db: "custom.sqlite", batchSize: 64, force: true, model: "alias-model"
      })
    );
  });

  it("uses the bundled absolute dataset and default batch size", async () => {
    await runCli(["knowledge", "build"]);
    expect(commands.runKnowledgeBuildCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: expect.stringMatching(/^\/.*\/data\/knowledge\/shellgei-basic\.jsonl$/),
        batchSize: 16
      })
    );
  });

  it("forwards the solve database option", async () => {
    await runCli(["solve", "print 42", "--knowledge-db", "custom.sqlite"]);
    expect(commands.runSolveCommand).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeDb: "custom.sqlite" })
    );
  });

  it("uses the database environment setting and lets explicit options override it", async () => {
    vi.stubEnv("SHELLGEIAI_KNOWLEDGE_DB", "environment.sqlite");
    try {
      await runCli(["knowledge", "search", "CSV"]);
      expect(commands.runKnowledgeSearchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ db: "environment.sqlite" })
      );
      await runCli(["knowledge", "build", "--db", "explicit.sqlite"]);
      expect(commands.runKnowledgeBuildCommand).toHaveBeenCalledWith(
        expect.objectContaining({ db: "explicit.sqlite" })
      );
      await runCli(["solve", "CSV", "--knowledge-db", "solve.sqlite"]);
      expect(commands.runSolveCommand).toHaveBeenCalledWith(
        expect.objectContaining({ knowledgeDb: "solve.sqlite" })
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["prepare", "build", "search"])("preserves the --model alias for knowledge %s", async (command) => {
    await withKnowledgeModelEnv("environment-model", () => runCli([
      "knowledge", command, ...(command === "search" ? ["CSV"] : []),
      "--model", "alias-model"
    ]));
    const handler = {
      prepare: commands.runKnowledgePrepareCommand,
      build: commands.runKnowledgeBuildCommand,
      search: commands.runKnowledgeSearchCommand
    }[command];
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ model: "alias-model", knowledgeModel: "environment-model" })
    );
  });

  it.each(["0", "65", "1.5", "NaN"])("rejects invalid embedding batch size %s", async (batchSize) => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runCli(["knowledge", "build", "--batch-size", batchSize]);
      expect(stderr.mock.calls.flat().join("")).toContain(
        "Invalid --batch-size value. Use integer 1 to 64."
      );
      expect(commands.runKnowledgeBuildCommand).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it.each([
    ["solve", "print 42", "--knowledge-vectors", "old.jsonl"],
    ["knowledge", "build", "--vectors", "old.jsonl"],
    ["knowledge", "search", "query", "--vectors", "old.json"]
  ])("explains migration for legacy vector flags %j", async (...args) => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runCli(args);
      expect(stderr.mock.calls.flat().join("")).toContain(
        "JSON/JSONL vector files are no longer supported"
      );
      expect(stderr.mock.calls.flat().join("")).toContain("knowledge build");
      expect(commands.runKnowledgeBuildCommand).not.toHaveBeenCalled();
      expect(commands.runKnowledgeSearchCommand).not.toHaveBeenCalled();
      expect(commands.runSolveCommand).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it("dispatches knowledge man with the curated profile", async () => {
    await runCli(["knowledge", "man", "--profile", "shellgei"]);

    expect(commands.runKnowledgeManCommand).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "shellgei" })
    );
  });

  it("dispatches logs list through the Commander action", async () => {
    await runCli(["logs", "list", "--limit", "5"]);

    expect(commands.runLogsListCommand).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 })
    );
  });

  it("treats Commander help command as a normal exit", async () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runCli(["help", "solve"]);
    } finally {
      stdoutWrite.mockRestore();
      consoleError.mockRestore();
    }

    expect(consoleError).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});
