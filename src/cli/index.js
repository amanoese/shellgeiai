import { createCliProgram, parseCliOptions } from "../cliOptions.js";
import { runCheckCommand } from "./commands/check.js";
import { runLogsListCommand } from "./commands/logsList.js";
import { runLogsPruneCommand } from "./commands/logsPrune.js";
import { runLogsSearchCommand } from "./commands/logsSearch.js";
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
      case "logs-list":
        await runLogsListCommand(options);
        return;
      case "logs-search":
        await runLogsSearchCommand(options);
        return;
      case "logs-prune":
        await runLogsPruneCommand(options);
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
