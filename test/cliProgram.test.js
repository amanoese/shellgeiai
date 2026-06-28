import { describe, expect, it } from "vitest";

import { createCliProgram } from "../src/cli/program.js";

function findCommand(program, name) {
  return program.commands.find((command) => command.name() === name);
}

function renderHelp(command) {
  let output = "";
  command.configureOutput({
    writeOut(text) {
      output += text;
    }
  });
  command.outputHelp();
  return output;
}

describe("createCliProgram", () => {
  it("uses Commander root help without duplicating subcommand option details", () => {
    const help = createCliProgram().helpInformation();

    expect(help).toContain("Usage: shellgeiai [options] [command]");
    expect(help).toContain("solve [options] <problem...>");
    expect(help).toContain("knowledge");
    expect(help).toContain("logs");
    expect(help).not.toContain("shellgeiai check");
    expect(help).not.toContain("shellgeiai replay");
    expect(help).not.toContain("--shellgei-score-mode");
    expect(help).not.toContain("--knowledge-model");
    expect(help).not.toContain("SHELLGEIAI_KNOWLEDGE_MODEL");
  });

  it("shows solve options in solve subcommand help", () => {
    const program = createCliProgram();
    const solve = findCommand(program, "solve");

    expect(solve.helpInformation()).toContain("--shellgei-score-mode");
    expect(solve.helpInformation()).toContain("--knowledge-model");
    expect(solve.helpInformation()).toContain("SHELLGEIAI_KNOWLEDGE_MODEL");
  });

  it("summarizes knowledge subcommand options in knowledge help", () => {
    const program = createCliProgram();
    const knowledge = findCommand(program, "knowledge");
    const help = renderHelp(knowledge);

    expect(help).toContain("Subcommand options:");
    expect(help).toContain("prepare:");
    expect(help).toContain("build:");
    expect(help).toContain("search:");
    expect(help).toContain("--knowledge-model");
    expect(help).toContain("SHELLGEIAI_KNOWLEDGE_MODEL");
    expect(help).toContain("--dataset");
    expect(help).toContain("--vectors");
    expect(help).toContain("--top-k");
  });
});
