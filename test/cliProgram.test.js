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
    expect(solve.helpInformation()).toMatch(/off, planner, worker, all, or\s+on/);
    expect(solve.helpInformation()).toContain("--docker-device-readonly <path>");
    expect(solve.helpInformation()).toContain("--device-ro <path>");
    expect(solve.helpInformation()).toContain("--knowledge-db <path>");
    expect(solve.helpInformation()).toContain("--llm-base-url <url>");
    expect(solve.helpInformation()).toContain("--llm-model <model>");
    expect(solve.helpInformation()).toContain("--planner-model <model>");
    expect(solve.helpInformation()).toContain("--llm-timeout <ms>");
    expect(solve.helpInformation()).toContain("--llm-max-retries <n>");
    expect(solve.helpInformation()).toContain("https://openrouter.ai/api/v1");
    expect(solve.helpInformation()).toContain("openai/gpt-6.1-sol");
    expect(solve.helpInformation()).toContain("LLM_BASE_URL");
    expect(solve.helpInformation()).toContain("SHELLGEIAI_PLANNER_MODEL");
    expect(solve.helpInformation()).toMatch(/default:.*api/);
    expect(solve.helpInformation()).not.toContain("--api-key");
  });

  it("summarizes knowledge subcommand options in knowledge help", () => {
    const program = createCliProgram();
    const knowledge = findCommand(program, "knowledge");
    const help = renderHelp(knowledge);

    expect(help).toContain("Subcommand options:");
    expect(help).toContain("prepare:");
    expect(help).toContain("build:");
    expect(help).toContain("search:");
    expect(help).toContain("man:");
    expect(help).toContain("--knowledge-model");
    expect(help).toContain("SHELLGEIAI_KNOWLEDGE_MODEL");
    expect(help).toContain("--dataset");
    expect(help).toContain("--db");
    expect(help).toContain("--batch-size");
    expect(help).toContain("--force");
    expect(help).not.toContain("--vectors");
    expect(help).toContain("--top-k");
    expect(help).toContain("--profile");
  });
});
