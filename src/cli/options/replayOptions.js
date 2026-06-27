import { parseNumber, takeValue } from "./shared.js";

export function parseReplay(argv) {
  const options = {
    command: "replay",
    runner: "docker"
  };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--log":
        options.logPath = takeValue(argv, index, "Missing --log value.");
        index += 1;
        break;
      case "--candidate-id":
        options.candidateId = takeValue(
          argv,
          index,
          "Missing value --candidate-id."
        );
        index += 1;
        break;
      case "--attempt-id":
        options.attemptId = takeValue(
          argv,
          index,
          "Missing value for --attempt-id."
        );
        index += 1;
        break;
      case "--runner":
        options.runner = takeValue(argv, index, "Missing value for --runner.");
        index += 1;
        break;
      case "--workdir":
        options.workdir = takeValue(argv, index, "Missing value for --workdir.");
        index += 1;
        break;
      case "--writable-workdir":
        options.writableWorkdir = true;
        break;
      case "--expected-output":
        options.expectedOutput = takeValue(
          argv,
          index,
          "Missing value for --expected-output."
        );
        index += 1;
        break;
      case "--time-budget":
        options.timeBudgetMs = parseNumber(
          takeValue(argv, index, "Missing value for --time-budget."),
          "Invalid --time-budget value. Use positive integer."
        );
        index += 1;
        break;
      case "--command-policy":
        options.commandPolicyPath = takeValue(
          argv,
          index,
          "Missing value for --command-policy."
        );
        index += 1;
        break;
      case "--sandbox-policy":
        options.sandboxPolicyPath = takeValue(
          argv,
          index,
          "Missing value for --sandbox-policy."
        );
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (!options.logPath) {
    throw new Error("Missing --log value.");
  }

  return options;
}
