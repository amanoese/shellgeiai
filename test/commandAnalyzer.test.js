import { describe, expect, it } from "vitest";

import { analyzeShellCommand } from "../src/solve/scoring/commandAnalyzer.js";

describe("analyzeShellCommand", () => {
  it("extracts pipeline commands and language one-liners from Bash AST", async () => {
    const features = await analyzeShellCommand(
      "printf '%s\n' 'a b' | perl -lane 'print $F[1]'"
    );

    expect(features).toMatchObject({
      parsed: true,
      parser: "tree-sitter-bash",
      commandNames: ["printf", "perl"],
      simpleCommandCount: 2,
      pipelineCount: 1,
      hasRedirection: false,
      hasCommandSubstitution: false,
      hasHereDoc: false,
      hasAndOrList: false,
      dangerousCommands: []
    });
    expect(features.languageOneLiners).toEqual([
      expect.objectContaining({
        command: "perl",
        option: "-lane",
        inPipeline: true
      })
    ]);
  });

  it("extracts redirection, command substitution, and dangerous commands", async () => {
    const features = await analyzeShellCommand("rm -rf $(pwd)/tmp > out.txt");

    expect(features.parsed).toBe(true);
    expect(features.commandNames).toContain("rm");
    expect(features.hasRedirection).toBe(true);
    expect(features.hasCommandSubstitution).toBe(true);
    expect(features.dangerousCommands).toContain("rm");
  });

  it("recognizes node -pe as a pipeline language one-liner without parsing JavaScript", async () => {
    const features = await analyzeShellCommand(
      "printf '%s\n' '{a: \"b\"}' | node -pe 'JSON.stringify(eval(`(${fs.readFileSync(0)})`))'"
    );

    expect(features.commandNames).toEqual(["printf", "node"]);
    expect(features.languageOneLiners).toEqual([
      expect.objectContaining({
        command: "node",
        option: "-pe",
        inPipeline: true
      })
    ]);
  });

  it("fails explicitly when the Bash parser cannot be loaded", async () => {
    await expect(
      analyzeShellCommand("printf 'x\n'", {
        parserProvider: async () => {
          throw new Error("missing parser");
        }
      })
    ).rejects.toThrow("Unable to analyze shell command with tree-sitter-bash.");
  });
});
