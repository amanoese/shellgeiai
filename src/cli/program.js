import { Command, InvalidArgumentError, Option } from "commander";

import { runLogsListCommand } from "./commands/logsList.js";
import { runLogsPruneCommand } from "./commands/logsPrune.js";
import { runLogsSearchCommand } from "./commands/logsSearch.js";
import { runLogsShowCommand } from "./commands/logsShow.js";
import {
  runKnowledgeBuildCommand,
  runKnowledgePrepareCommand,
  runKnowledgeSearchCommand
} from "./commands/knowledge.js";
import { runSolveCommand } from "./commands/solve.js";
import { DEFAULT_KNOWLEDGE_DATASET } from "../knowledge/commands.js";
import {
  DEFAULT_KNOWLEDGE_MODEL,
  KNOWLEDGE_MODEL_ENV
} from "../knowledge/modelConfig.js";

const supportedModes = new Set(["single", "parallel"]);
const supportedSelectors = new Set(["first-pass-wins", "best-score-wins"]);
const supportedProgressModes = new Set(["off", "plain", "jsonl", "bar"]);
const supportedScoreModes = new Set(["simple", "artistry", "robustness"]);
const supportedKnowledgeModes = new Set(["off", "worker"]);

function parsePositiveInteger(value, message) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(message);
  }
  return parsed;
}

function parseNonNegativeNumber(value, message) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError(message);
  }
  return parsed;
}

function parseParallelism(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2) {
    throw new InvalidArgumentError(
      "Invalid --parallelism value. Use integer 2 or greater."
    );
  }
  return parsed;
}

function parseChoice(value, supported, message) {
  if (!supported.has(value)) {
    throw new InvalidArgumentError(message);
  }
  return value;
}

function knowledgeModelOption(flags = "--knowledge-model <model>") {
  return new Option(flags, "knowledge embedding model")
    .env(KNOWLEDGE_MODEL_ENV)
    .default(DEFAULT_KNOWLEDGE_MODEL);
}

function summarizeSubcommandOptions(command) {
  const helper = command.createHelp();
  const summaries = command.commands
    .filter((subcommand) => subcommand.options.length > 0)
    .map((subcommand) => {
      const options = helper
        .visibleOptions(subcommand)
        .filter((option) => option.long !== "--help")
        .map(
          (option) =>
            `    ${helper.optionTerm(option)}  ${helper.optionDescription(option)}`
        );
      return [`  ${subcommand.name()}:`, ...options].join("\n");
    });

  if (summaries.length === 0) {
    return "";
  }

  return `\nSubcommand options:\n${summaries.join("\n")}`;
}

export function createCliProgram() {
  const program = new Command();

  program
    .name("shellgeiai")
    .description(
      "Generate, run, and verify shell one-liners safely for ShellGei problems."
    )
    .showHelpAfterError()
    .exitOverride();

  program
    .command("solve")
    .description("solve a ShellGei problem")
    .argument("<problem...>", "problem statement")
    .option("--engine <engine>", "agent engine", "openai")
    .option("--runner <runner>", "command runner", "docker")
    .option(
      "--max-iter <number>",
      "maximum worker retry count",
      (value) =>
        parsePositiveInteger(
          value,
          "Invalid --max-iter value. Use positive integer."
        ),
      3
    )
    .option("--workdir <path>", "working directory")
    .option("--writable-workdir", "allow writes to the working directory")
    .option(
      "--mode <mode>",
      "solve mode",
      (value) =>
        parseChoice(
          value,
          supportedModes,
          "Invalid --mode value. Use single or parallel."
        ),
      "single"
    )
    .option("--parallelism <number>", "parallel worker count", parseParallelism, 4)
    .option(
      "--selector <name>",
      "result selector",
      (value) =>
        parseChoice(
          value,
          supportedSelectors,
          "Invalid --selector value. Use first-pass-wins or best-score-wins."
        ),
      "best-score-wins"
    )
    .option(
      "--shellgei-score-mode <mode>",
      "shellgei scoring mode",
      (value) =>
        parseChoice(
          value,
          supportedScoreModes,
          "Invalid --shellgei-score-mode value. Use simple, artistry, or robustness."
        ),
      "simple"
    )
    .option(
      "--knowledge <mode>",
      "knowledge mode",
      (value) =>
        parseChoice(
          value,
          supportedKnowledgeModes,
          "Invalid --knowledge value. Use off or worker."
        ),
      "off"
    )
    .addOption(knowledgeModelOption())
    .option("--knowledge-dataset <path>", "knowledge dataset", DEFAULT_KNOWLEDGE_DATASET)
    .option("--knowledge-vectors <path>", "knowledge vectors file")
    .option(
      "--time-budget <ms>",
      "time budget in milliseconds",
      (value) =>
        parsePositiveInteger(
          value,
          "Invalid --time-budget value. Use positive integer."
        )
    )
    .option("--command-policy <path>", "command policy file")
    .option("--sandbox-policy <path>", "sandbox policy file")
    .option(
      "--progress <mode>",
      "progress output mode",
      (value) =>
        parseChoice(
          value,
          supportedProgressModes,
          "Invalid --progress value. Use off, plain, jsonl, or bar."
        ),
      "bar"
    )
    .action((problemParts, options) =>
      runSolveCommand({ ...options, problem: problemParts.join(" ") })
    );

  const knowledge = program
    .command("knowledge")
    .description("manage and search the knowledge corpus")
    .addHelpText("after", ({ command }) => summarizeSubcommandOptions(command));

  knowledge
    .command("prepare")
    .description("prepare knowledge data")
    .addOption(knowledgeModelOption())
    .addOption(new Option("--model <model>", "knowledge embedding model alias"))
    .action((options) => runKnowledgePrepareCommand(options));

  knowledge
    .command("build")
    .description("build knowledge vectors")
    .addOption(knowledgeModelOption())
    .addOption(new Option("--model <model>", "knowledge embedding model alias"))
    .option("--dataset <path>", "knowledge dataset", DEFAULT_KNOWLEDGE_DATASET)
    .option("--vectors <path>", "knowledge vectors file")
    .action((options) => runKnowledgeBuildCommand(options));

  knowledge
    .command("search")
    .description("search knowledge vectors")
    .argument("<query...>", "search query")
    .addOption(knowledgeModelOption())
    .addOption(new Option("--model <model>", "knowledge embedding model alias"))
    .option("--dataset <path>", "knowledge dataset", DEFAULT_KNOWLEDGE_DATASET)
    .option("--vectors <path>", "knowledge vectors file")
    .option(
      "--top-k <number>",
      "maximum number of search results",
      (value) =>
        parsePositiveInteger(
          value,
          "Invalid --top-k value. Use positive integer."
        ),
      10
    )
    .action((queryParts, options) =>
      runKnowledgeSearchCommand({ ...options, query: queryParts.join(" ") })
    );

  const logs = program.command("logs").description("inspect solve logs");

  logs
    .command("show")
    .description("show a solve log")
    .argument("<run-id>", "run id")
    .action((logRef) => runLogsShowCommand({ logRef }));

  logs
    .command("list")
    .description("list saved solve logs")
    .option(
      "--limit <number>",
      "maximum number of logs",
      (value) =>
        parsePositiveInteger(
          value,
          "Invalid --limit value. Use positive integer."
        )
    )
    .action((options) => runLogsListCommand(options));

  logs
    .command("search")
    .description("search saved solve logs")
    .argument("<query...>", "search query")
    .option("--mode <mode>", "log mode")
    .option("--passed", "only include passing logs")
    .option("--failed", "only include failing logs")
    .option(
      "--limit <number>",
      "maximum number of logs",
      (value) =>
        parsePositiveInteger(
          value,
          "Invalid --limit value. Use positive integer."
        )
    )
    .action((queryParts, options) =>
      runLogsSearchCommand({
        ...options,
        query: queryParts.join(" "),
        passed:
          options.passed === true
            ? true
            : options.failed === true
              ? false
              : undefined
      })
    );

  logs
    .command("prune")
    .description("prune old saved solve logs")
    .requiredOption(
      "--retain-days <days>",
      "keep logs newer than this many days",
      (value) =>
        parseNonNegativeNumber(
          value,
          "Invalid --retain-days value. Use non-negative number."
        )
    )
    .option("--dry-run", "show what would be deleted without deleting")
    .action((options) => runLogsPruneCommand(options));

  return program;
}
