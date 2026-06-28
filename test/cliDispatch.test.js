import { beforeEach, describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({
  runLogsListCommand: vi.fn(),
  runLogsPruneCommand: vi.fn(),
  runLogsSearchCommand: vi.fn(),
  runLogsShowCommand: vi.fn(),
  runKnowledgeBuildCommand: vi.fn(),
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
