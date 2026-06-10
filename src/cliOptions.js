import { Command, CommanderError, Option } from "commander";
import { z } from "zod";

const supportedModes = ["single", "parallel"];
const supportedSelectors = ["first-pass-wins", "best-score-wins"];

const hiddenModeOption = new Option("--mode <mode>").hideHelp();
const hiddenParallelismOption = new Option("--parallelism <number>").hideHelp();
const hiddenSelectorOption = new Option("--selector <name>").hideHelp();
const hiddenTimeBudgetOption = new Option("--time-budget <ms>").hideHelp();
const hiddenCommandPolicyOption = new Option("--command-policy <path>").hideHelp();
const hiddenSandboxPolicyOption = new Option("--sandbox-policy <path>").hideHelp();
const hiddenRunnerOption = new Option("--runner <runner>").hideHelp();

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
  sandboxPolicyPath: z.string().trim().min(1).optional()
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
    .addOption(hiddenRunnerOption)
    .addOption(hiddenModeOption)
    .addOption(hiddenParallelismOption)
    .addOption(hiddenSelectorOption)
    .addOption(hiddenTimeBudgetOption)
    .addOption(hiddenCommandPolicyOption)
    .addOption(hiddenSandboxPolicyOption)
    .allowExcessArguments(false)
    .allowUnknownOption(false);

  return program;
}

export function parseCliOptions(argv) {
  const program = createCliProgram();
  const solveCommand = program.commands[0];
  let parsedOptions;

  solveCommand.action((problemParts, options) => {
    parsedOptions = {
      command: "solve",
      problem: problemParts.join(" "),
      engine: options.engine,
      runner: options.runner ?? "local",
      maxIter: Number(options.maxIter),
      workdir: options.workdir,
      mode: options.mode ?? "single",
      parallelism: Number(options.parallelism ?? "1"),
      selector: options.selector ?? "first-pass-wins",
      timeBudgetMs: options.timeBudget == null ? undefined : Number(options.timeBudget),
      commandPolicyPath: options.commandPolicy,
      sandboxPolicyPath: options.sandboxPolicy
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
    throw new Error("Only the 'solve' command is currently supported.");
  }

  const result = cliOptionsSchema.safeParse(parsedOptions);
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
    case "commandPolicyPath":
      throw new Error("Missing value for --command-policy.");
    case "sandboxPolicyPath":
      throw new Error("Missing value for --sandbox-policy.");
    case "problem":
      throw new Error("Missing <problem> argument.");
    default:
      throw new Error(issue.message);
  }
}
