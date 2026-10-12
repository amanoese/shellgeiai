import { describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({
  prepareKnowledgeModel: vi.fn(), buildKnowledgeVectors: vi.fn(), searchKnowledge: vi.fn()
}));
vi.mock("../dist/knowledge/commands.js", () => commands);

import { runKnowledgeManCommand, runKnowledgePrepareCommand, runKnowledgeBuildCommand, runKnowledgeSearchCommand } from "../dist/cli/commands/knowledge.js";

describe("knowledge SQLite command output", () => {
  it("forwards build configuration and reports the active generation", async () => {
    commands.buildKnowledgeVectors.mockResolvedValue({itemCount: 2, model: "alias", dimensions: 4096,
      dbPath: "/tmp/result.sqlite", generationId: 7, reused: true});
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runKnowledgeBuildCommand({dataset: "custom.jsonl", db: "custom.sqlite", model: "alias",
        knowledgeModel: "environment", batchSize: 1, force: true});
      expect(commands.buildKnowledgeVectors).toHaveBeenCalledWith({datasetPath: "custom.jsonl", dbPath: "custom.sqlite",
        model: "alias", batchSize: 1, force: true});
      expect(stdout.mock.calls.flat().join("")).toContain("Knowledge database reused: 2 items -> /tmp/result.sqlite");
      expect(stdout.mock.calls.flat().join("")).toContain("model: alias\ndimensions: 4096\ngeneration: 7");
    } finally { stdout.mockRestore(); }
  });

  it("searches the requested database and reports its model and path", async () => {
    commands.searchKnowledge.mockResolvedValue({query: "CSV", model: "environment", dbPath: "/tmp/search.sqlite",
      results: [{id: "csv", kind: "example", text: "CSV", score: 0.5}]});
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runKnowledgeSearchCommand({query: "CSV", dataset: "custom.jsonl", db: "custom.sqlite", knowledgeModel: "environment", topK: 5});
      expect(commands.searchKnowledge).toHaveBeenCalledWith({query: "CSV", datasetPath: "custom.jsonl", dbPath: "custom.sqlite",
        model: "environment", topK: 5});
      expect(stdout.mock.calls.flat().join("")).toContain("model: environment\ndatabase: /tmp/search.sqlite");
      expect(stdout.mock.calls.flat().join("")).toContain("csv score=0.5000");
    } finally { stdout.mockRestore(); }
  });

  it("reports the prepare API and native check", async () => {
    commands.prepareKnowledgeModel.mockResolvedValue({model: "alias", dimensions: 4096, provider: "openrouter"});
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runKnowledgePrepareCommand({model: "alias", knowledgeModel: "environment"});
      expect(commands.prepareKnowledgeModel).toHaveBeenCalledWith({model: "alias"});
      expect(stdout).toHaveBeenCalledWith("Knowledge API/native check passed: alias dimensions=4096 provider=openrouter\n");
    } finally { stdout.mockRestore(); }
  });
});

describe("runKnowledgeManCommand", () => {
  it("uses the existing man generator with its shellgei defaults", async () => {
    const buildManKnowledge = vi.fn(async (options) => ({
      entries: 1,
      failed: 0,
      output: options.output,
      profile: options.profile,
      records: 2
    }));
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await runKnowledgeManCommand(
        { profile: "shellgei" },
        { buildManKnowledge }
      );

      expect(buildManKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          output: "data/knowledge/man.jsonl",
          profile: "shellgei",
          sections: null,
          commands: null
        })
      );
      expect(stdoutWrite).toHaveBeenCalledWith(
        "Man knowledge built: 2 records -> data/knowledge/man.jsonl\n"
      );
    } finally {
      stdoutWrite.mockRestore();
    }
  });
});
