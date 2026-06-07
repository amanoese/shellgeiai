"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCliProgram = createCliProgram;
exports.parseCliOptions = parseCliOptions;
const commander_1 = require("commander");
const zod_1 = require("zod");
const cliOptionsSchema = zod_1.z.object({
    command: zod_1.z.literal("solve"),
    problem: zod_1.z.string().trim().min(1, "Missing <problem> argument."),
    engine: zod_1.z.enum(["mock", "codex", "cursor"]),
    maxIter: zod_1.z.number().int().positive(),
    workdir: zod_1.z.string().trim().min(1).optional()
});
function createCliProgram() {
    const program = new commander_1.Command()
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
function parseCliOptions(argv) {
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
    }
    catch (error) {
        if (error instanceof commander_1.CommanderError) {
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
