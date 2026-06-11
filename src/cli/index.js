import { createCliProgram, parseCliOptions } from "../cliOptions.js";
import { runCheckCommand } from "./commands/check.js";
import { runLogsShowCommand } from "./commands/logsShow.js";
import { runReplayCommand } from "./commands/replay.js";
import { runSolveCommand } from "./commands/solve.js";

function printUsage() {
  process.stderr.write(`${createCliProgram().helpInformation()}\n`);
}

export async function runCli(argv) {
  try {
    const options = parseCliOptions(argv);

    switch (options.command) {
      case "solve":
        await runSolveCommand(options);
        return;
      case "check":
        await runCheckCommand(options);
        return;
      case "replay":
        await runReplayCommand(options);
        return;
      case "logs-show":
        await runLogsShowCommand(options);
        return;
      default:
        throw new Error(`Unsupported command: ${String(options.command)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    printUsage();
    process.exitCode = 1;
  }
}
