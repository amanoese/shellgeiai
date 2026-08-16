import { describe, expect, it, vi } from "vitest";

import { runKnowledgeManCommand } from "../src/cli/commands/knowledge.js";

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
