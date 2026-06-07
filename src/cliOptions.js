import { Command, CommanderError } from "commander";
import { z } from "zod";

const cliOptionsSchema = z.object({
  command: z.literal("solve"),
  problem: z.string().trim().min(1, "Missing <problem> argument."),
  engine: z.enum(["mock", "codex", "cursor"]),
  maxIter: z.number().int().positive(),
  workdir: z.string().trim().min(1).optional()
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
    .option("--engine <engine>", "engine to use: mock, codex, or cursor", "mock")
    .option("--max-iter <number>", "maximum solve iterations", "3")
    .option("--workdir <path>", "working directory to reuse")
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
      maxIter: Number(options.maxIter),
      workdir: options.workdir
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
      throw new Error("Invalid --engine value. Use mock, codex, or cursor.");
    case "maxIter":
      throw new Error("Invalid --max-iter value. Use a positive integer.");
    case "workdir":
      throw new Error("Missing value for --workdir.");
    case "problem":
      throw new Error("Missing <problem> argument.");
    default:
      throw new Error(issue.message);
  }
}
