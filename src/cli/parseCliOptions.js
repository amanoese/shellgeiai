import { parseCheck } from "./options/checkOptions.js";
import { parseLogs } from "./options/logsOptions.js";
import { parseReplay } from "./options/replayOptions.js";
import { isHelpToken } from "./options/shared.js";
import { parseSolve } from "./options/solveOptions.js";

export function createCliProgram() {
  const helpText = [
    "Usage:",
    " shellgeiai --help",
    " shellgeiai solve <problem> [options]",
    " shellgeiai check <command> [options]",
    " shellgeiai replay --log <path> [options]",
    " shellgeiai logs show <run-id>",
    "",
    "Solve options:",
    " --engine <engine>",
    " --runner <runner>",
    " --max-iter <number>",
    " --workdir <path>",
    " --writable-workdir",
    " --mode <mode>",
    " --parallelism <number>",
    " --selector <name>",
    " --shellgei-score-mode <mode>",
    " --time-budget <ms>",
    " --command-policy <path>",
    " --sandbox-policy <path>",
    " --progress <mode>"
  ].join("\n");

  return {
    helpInformation() {
      return helpText;
    }
  };
}

export function parseCliOptions(argv) {
  const command = argv[0];
  if (command == null || isHelpToken(command)) {
    return { command: "help" };
  }

  if (argv.length >= 2 && isHelpToken(argv[1])) {
    return { command: "help", topic: command };
  }

  switch (command) {
    case "solve":
      return parseSolve(argv);
    case "check":
      return parseCheck(argv);
    case "replay":
      return parseReplay(argv);
    case "logs":
      return parseLogs(argv);
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
}
