import { Command, CommanderError, Option } from "commander";
import { z } from "zod";

const supportedModes = ["single", "parallel"];
const supportedSelectors = ["first-pass-wins", "best-score-wins"];
const supportedProgressModes = ["off", "plain", "jsonl", "bar"];
const defaultRunner = "docker";

const modeOption = new Option("--mode <mode>", "execution mode: single or parallel");
const parallelismOption = new Option("--parallelism <number>", "number of workers to plan");
const selectorOption = new Option("--selector <name>", "selector to use: first-pass-wins or best-score-wins");
const timeBudgetOption = new Option("--time-budget <ms>", "overall session time budget in milliseconds");
const commandPolicyOption = new Option("--command-policy <path>", "path to a command policy JSON file");
const sandboxPolicyOption = new Option("--sandbox-policy <path>", "path to a sandbox policy JSON file");
const runnerOption = new Option("--runner <runner>", "runner to use: local or docker");
const progressOption = new Option("--progress <mode>", "progress output: off, plain, jsonl, or bar");

const cliOptionsSchema = z.object({
  command: z.literal("solve"),
  problem: z.string().trim().min(1, "Missing <problem> argument."),
  engine: z.enum(["openai", "mock"]),
  runner: z.enum(["local", "docker"]),
  maxIter: z.number().int().positive(),
  workdir: z.string().trim().min(1).optional(),
  mode: z.enum(supportedModes),
  parallelism: z.number().int().positive(),
  selector: z.enum(supportedSelectors),
  timeBudgetMs: z.number().int().positive().optional(),
  commandPolicyPath: z.string().trim().min(1).optional(),
  sandboxPolicyPath: z.string().trim().min(1).optional(),
  progress: z.enum(supportedProgressModes)
});

const checkCliOptionsSchema = z.object({
  command: z.literal("check"),
  shellCommand: z.string().trim().min(1, "Missing <command> argument."),
  runner: z.enum(["local", "docker"]),
  workdir: z.string().trim().min(1).optional(),
  problem: z.string().trim().min(1).optional(),
  expectedOutput: z.string().optional(),
  timeBudgetMs: z.number().int().positive().optional(),
  commandPolicyPath: z.string().trim().min(1).optional(),
  sandboxPolicyPath: z.string().trim().min(1).optional()
});

const replayCliOptionsSchema = z.object({
  command: z.literal("replay"),
  logPath: z.string().trim().min(1, "Missing --log value."),
  candidateId: z.string().trim().min(1).optional(),
  attemptId: z.string().trim().min(1).optional(),
  runner: z.enum(["local", "docker"]),
  workdir: z.string().trim().min(1).optional(),
  expectedOutput: z.string().optional(),
  timeBudgetMs: z.number().int().positive().optional(),
  commandPolicyPath: z.string().trim().min(1).optional(),
  sandboxPolicyPath: z.string().trim().min(1).optional()
});

const logsShowCliOptionsSchema = z.object({
  command: z.literal("logs-show"),
  logRef: z.string().trim().min(1, "Missing <run-id> argument.")
});

const logsListCliOptionsSchema = z.object({
  command: z.literal("logs-list"),
  limit: z.number().int().positive().optional()
});

const logsSearchCliOptionsSchema = z.object({
  command: z.literal("logs-search"),
  query: z.string().trim().min(1, "Missing <query> argument."),
  mode: z.enum(["solve", "check", "replay"]).optional(),
  passed: z.boolean().optional(),
  limit: z.number().int().positive().optional()
});

const logsPruneCliOptionsSchema = z.object({
  command: z.literal("logs-prune"),
  retainDays: z.number().int().nonnegative(),
  dryRun: z.boolean()
});

export function createCliProgram() {
  const program = new Command()
    .name("shellgeiai")
    .description("Generate, run, and verify shell one-liners safely.")
    .showHelpAfterError();

  program
    .command("solve")
    .description("Solve a shell-gei problem with the selected engine.")
    .argument("<problem...>", "problem statement")
    .option("--engine <engine>", "engine to use: openai or mock", "openai")
    .option("--max-iter <number>", "maximum solve iterations", "3")
    .option("--workdir <path>", "working directory to reuse")
    .addOption(runnerOption)
    .addOption(modeOption)
    .addOption(parallelismOption)
    .addOption(selectorOption)
    .addOption(timeBudgetOption)
    .addOption(commandPolicyOption)
    .addOption(sandboxPolicyOption)
    .addOption(progressOption)
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  program
    .command("check")
    .description("Run and judge an explicit shell command.")
    .argument("<command...>", "shell command to execute")
    .option("--workdir <path>", "working directory to reuse")
    .addOption(runnerOption)
    .addOption(timeBudgetOption)
    .addOption(commandPolicyOption)
    .addOption(sandboxPolicyOption)
    .option("--problem <text>", "problem text to store alongside this check")
    .option("--expected-output <text>", "expected stdout to compare against")
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  program
    .command("replay")
    .description("Replay a candidate or attempt from a saved session log.")
    .option("--log <path>", "path to a saved solve/check/replay log")
    .option("--candidate-id <id>", "candidate id to replay")
    .option("--attempt-id <id>", "attempt id to replay")
    .option("--workdir <path>", "working directory to reuse")
    .addOption(runnerOption)
    .addOption(timeBudgetOption)
    .addOption(commandPolicyOption)
    .addOption(sandboxPolicyOption)
    .option("--expected-output <text>", "override expected stdout during replay")
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  const logsCommand = program
    .command("logs")
    .description("Inspect saved session logs.")
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  logsCommand
    .command("show")
    .description("Show a saved log by run id, filename, or path.")
    .argument("<run-id>", "saved run id, filename, or log path")
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  logsCommand
    .command("list")
    .description("List saved logs newest-first.")
    .option("--limit <number>", "limit the number of logs to display")
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  logsCommand
    .command("search")
    .description("Search saved logs by text and filters.")
    .argument("[query...]", "search text")
    .option("--mode <mode>", "filter by mode: solve, check, or replay")
    .option("--passed", "filter to passed logs")
    .option("--failed", "filter to failed logs")
    .option("--limit <number>", "limit the number of logs to display")
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  logsCommand
    .command("prune")
    .description("Delete logs older than the retention window.")
    .option("--retain-days <number>", "retain logs newer than this many days")
    .option("--dry-run", "report what would be deleted without removing files")
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  return program;
}

export function parseCliOptions(argv) {
  const program = createCliProgram();
  let parsedOptions;

  const solveCommand = program.commands.find((command) => command.name() === "solve");
  const checkCommand = program.commands.find((command) => command.name() === "check");
  const replayCommand = program.commands.find((command) => command.name() === "replay");
  const logsCommand = program.commands.find((command) => command.name() === "logs");
  const logsShowCommand = logsCommand?.commands.find((command) => command.name() === "show");
  const logsListCommand = logsCommand?.commands.find((command) => command.name() === "list");
  const logsSearchCommand = logsCommand?.commands.find((command) => command.name() === "search");
  const logsPruneCommand = logsCommand?.commands.find((command) => command.name() === "prune");

  solveCommand?.action((problemParts, options) => {
    parsedOptions = {
      command: "solve",
      problem: problemParts.join(" "),
      engine: options.engine,
      runner: options.runner ?? defaultRunner,
      maxIter: Number(options.maxIter),
      workdir: options.workdir,
      mode: options.mode ?? "single",
      parallelism: Number(options.parallelism ?? "1"),
      selector: options.selector ?? "first-pass-wins",
      timeBudgetMs: options.timeBudget == null ? undefined : Number(options.timeBudget),
      commandPolicyPath: options.commandPolicy,
      sandboxPolicyPath: options.sandboxPolicy,
      progress: options.progress ?? "off"
    };
  });

  checkCommand?.action((commandParts, options) => {
    parsedOptions = {
      command: "check",
      shellCommand: commandParts.join(" "),
      runner: options.runner ?? defaultRunner,
      workdir: options.workdir,
      problem: options.problem,
      expectedOutput: options.expectedOutput,
      timeBudgetMs: options.timeBudget == null ? undefined : Number(options.timeBudget),
      commandPolicyPath: options.commandPolicy,
      sandboxPolicyPath: options.sandboxPolicy
    };
  });

  replayCommand?.action((options) => {
    parsedOptions = {
      command: "replay",
      logPath: options.log,
      candidateId: options.candidateId,
      attemptId: options.attemptId,
      runner: options.runner ?? defaultRunner,
      workdir: options.workdir,
      expectedOutput: options.expectedOutput,
      timeBudgetMs: options.timeBudget == null ? undefined : Number(options.timeBudget),
      commandPolicyPath: options.commandPolicy,
      sandboxPolicyPath: options.sandboxPolicy
    };
  });

  logsShowCommand?.action((logRef) => {
    parsedOptions = {
      command: "logs-show",
      logRef
    };
  });

  logsListCommand?.action((options) => {
    parsedOptions = {
      command: "logs-list",
      limit: options.limit == null ? undefined : Number(options.limit)
    };
  });

  logsSearchCommand?.action((queryParts, options) => {
    const searchParts = Array.isArray(queryParts) ? queryParts : [];

    if (options.passed && options.failed) {
      throw new Error("Use either --passed or --failed, not both.");
    }

    parsedOptions = {
      command: "logs-search",
      query: searchParts.join(" "),
      mode: options.mode,
      passed: options.failed ? false : options.passed ? true : undefined,
      limit: options.limit == null ? undefined : Number(options.limit)
    };
  });

  logsPruneCommand?.action((options) => {
    parsedOptions = {
      command: "logs-prune",
      retainDays: options.retainDays == null ? Number.NaN : Number(options.retainDays),
      dryRun: Boolean(options.dryRun)
    };
  });

  try {
    program.exitOverride();
    program.parse(["node", "shellgeiai", ...argv]);
  } catch (error) {
    if (error instanceof CommanderError) {
      throw new Error(error.message);
    }
    throw error;
  }

  if (!parsedOptions) {
    throw new Error("A supported subcommand is required: solve, check, replay, or logs show.");
  }

  const result =
    parsedOptions.command === "solve"
      ? cliOptionsSchema.safeParse(parsedOptions)
      : parsedOptions.command === "check"
        ? checkCliOptionsSchema.safeParse(parsedOptions)
        : parsedOptions.command === "replay"
          ? replayCliOptionsSchema.safeParse(parsedOptions)
          : parsedOptions.command === "logs-list"
            ? logsListCliOptionsSchema.safeParse(parsedOptions)
            : parsedOptions.command === "logs-search"
              ? logsSearchCliOptionsSchema.safeParse(parsedOptions)
              : parsedOptions.command === "logs-prune"
                ? logsPruneCliOptionsSchema.safeParse(parsedOptions)
                : logsShowCliOptionsSchema.safeParse(parsedOptions);

  if (result.success) {
    return result.data;
  }

  const issue = result.error.issues[0];
  switch (issue.path[0]) {
    case "engine":
      throw new Error("Invalid --engine value. Use openai or mock.");
    case "runner":
      throw new Error("Invalid --runner value. Use local or docker.");
    case "maxIter":
      throw new Error("Invalid --max-iter value. Use a positive integer.");
    case "workdir":
      throw new Error("Missing value for --workdir.");
    case "parallelism":
      throw new Error("Invalid --parallelism value. Use a positive integer.");
    case "timeBudgetMs":
      throw new Error("Invalid --time-budget value. Use a positive integer.");
    case "mode":
      throw new Error("Invalid --mode value. Use single or parallel.");
    case "selector":
      throw new Error("Invalid --selector value. Use first-pass-wins or best-score-wins.");
    case "shellCommand":
      throw new Error("Missing <command> argument.");
    case "logPath":
      throw new Error("Missing --log value.");
    case "logRef":
      throw new Error("Missing <run-id> argument.");
    case "query":
      throw new Error("Missing <query> argument.");
    case "limit":
      throw new Error("Invalid --limit value. Use a positive integer.");
    case "retainDays":
      throw new Error("Invalid --retain-days value. Use a non-negative integer.");
    case "commandPolicyPath":
      throw new Error("Missing value for --command-policy.");
    case "sandboxPolicyPath":
      throw new Error("Missing value for --sandbox-policy.");
    case "progress":
      throw new Error("Invalid --progress value. Use off, plain, jsonl, or bar.");
    case "problem":
      throw new Error("Missing <problem> argument.");
    default:
      throw new Error(issue.message);
  }
}
