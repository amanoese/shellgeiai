import { isFlag, parseNumber, takeValue } from "./shared.js";

export function parseCheck(argv) {
  const commandParts = [];
  const options = {
    command: "check",
    runner: "docker"
  };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!isFlag(token)) {
      commandParts.push(token);
      continue;
    }

    switch (token) {
      case "--runner":
        options.runner = takeValue(argv, index, "Missing value --runner.");
        index += 1;
        break;
      case "--workdir":
        options.workdir = takeValue(argv, index, "Missing value --workdir.");
        index += 1;
        break;
      case "--writable-workdir":
        options.writableWorkdir = true;
        break;
      case "--time-budget":
        options.timeBudgetMs = parseNumber(
          takeValue(argv, index, "Missing value --time-budget."),
          "Invalid --time-budget value. Use positive integer."
        );
        index += 1;
        break;
      case "--problem":
        options.problem = takeValue(argv, index, "Missing value --problem.");
        index += 1;
        break;
      case "--expected-output":
        options.expectedOutput = takeValue(
          argv,
          index,
          "Missing value --expected-output."
        );
        index += 1;
        break;
      case "--command-policy":
        options.commandPolicyPath = takeValue(
          argv,
          index,
          "Missing value --command-policy."
        );
        index += 1;
        break;
      case "--sandbox-policy":
        options.sandboxPolicyPath = takeValue(
          argv,
          index,
          "Missing value --sandbox-policy."
        );
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (commandParts.length === 0) {
    throw new Error("Missing <command> argument.");
  }

  return {
    ...options,
    shellCommand: commandParts.join(" ")
  };
}
