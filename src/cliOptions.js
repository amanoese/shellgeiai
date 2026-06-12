const supportedModes = new Set(["single", "parallel"]);
const supportedSelectors = new Set(["first-pass-wins", "best-score-wins"]);
const supportedProgressModes = new Set(["off", "plain", "jsonl", "bar"]);
const supportedScoreModes = new Set(["standard", "competition", "practical", "appreciation"]);

function isFlag(value) {
  return typeof value === "string" && value.startsWith("--");
}

function parseNumber(value, message) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(message);
  }
  return parsed;
}

function takeValue(argv, index, message) {
  const value = argv[index + 1];
  if (value == null || isFlag(value)) {
    throw new Error(message);
  }
  return value;
}

function parseSolve(argv) {
  const positionals = [];
  const options = {
    command: "solve",
    engine: "openai",
    runner: "docker",
    maxIter: 3,
    mode: "single",
    parallelism: 1,
    selector: "first-pass-wins",
    shellgeiScoreMode: "standard",
    progress: "off"
  };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!isFlag(token)) {
      positionals.push(token);
      continue;
    }

    switch (token) {
      case "--engine":
        options.engine = takeValue(argv, index, "Missing value for --engine.");
        index += 1;
        break;
      case "--runner":
        options.runner = takeValue(argv, index, "Missing value for --runner.");
        index += 1;
        break;
      case "--max-iter":
        options.maxIter = parseNumber(
          takeValue(argv, index, "Missing value for --max-iter."),
          "Invalid --max-iter value. Use a positive integer."
        );
        index += 1;
        break;
      case "--workdir":
        options.workdir = takeValue(argv, index, "Missing value for --workdir.");
        index += 1;
        break;
      case "--mode":
        options.mode = takeValue(argv, index, "Missing value for --mode.");
        if (!supportedModes.has(options.mode)) {
          throw new Error("Invalid --mode value. Use single or parallel.");
        }
        index += 1;
        break;
      case "--parallelism":
        options.parallelism = parseNumber(
          takeValue(argv, index, "Missing value for --parallelism."),
          "Invalid --parallelism value. Use a positive integer."
        );
        index += 1;
        break;
      case "--selector":
        options.selector = takeValue(argv, index, "Missing value for --selector.");
        if (!supportedSelectors.has(options.selector)) {
          throw new Error(
            "Invalid --selector value. Use first-pass-wins or best-score-wins."
          );
        }
        index += 1;
        break;
      case "--shellgei-score-mode":
        options.shellgeiScoreMode = takeValue(
          argv,
          index,
          "Missing value for --shellgei-score-mode."
        );
        if (!supportedScoreModes.has(options.shellgeiScoreMode)) {
          throw new Error(
            "Invalid --shellgei-score-mode value. Use standard, competition, practical, or appreciation."
          );
        }
        index += 1;
        break;
      case "--time-budget":
        options.timeBudgetMs = parseNumber(
          takeValue(argv, index, "Missing value for --time-budget."),
          "Invalid --time-budget value. Use a positive integer."
        );
        index += 1;
        break;
      case "--command-policy":
        options.commandPolicyPath = takeValue(argv, index, "Missing value for --command-policy.");
        index += 1;
        break;
      case "--sandbox-policy":
        options.sandboxPolicyPath = takeValue(argv, index, "Missing value for --sandbox-policy.");
        index += 1;
        break;
      case "--progress":
        options.progress = takeValue(argv, index, "Missing value for --progress.");
        if (!supportedProgressModes.has(options.progress)) {
          throw new Error("Invalid --progress value. Use off, plain, jsonl, or bar.");
        }
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (positionals.length === 0) {
    throw new Error("Missing <problem> argument.");
  }

  return {
    ...options,
    problem: positionals.join(" ")
  };
}

function parseCheck(argv) {
  const commandParts = [];
  const options = { command: "check", runner: "docker" };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!isFlag(token)) {
      commandParts.push(token);
      continue;
    }

    switch (token) {
      case "--runner":
        options.runner = takeValue(argv, index, "Missing value for --runner.");
        index += 1;
        break;
      case "--workdir":
        options.workdir = takeValue(argv, index, "Missing value for --workdir.");
        index += 1;
        break;
      case "--time-budget":
        options.timeBudgetMs = parseNumber(
          takeValue(argv, index, "Missing value for --time-budget."),
          "Invalid --time-budget value. Use a positive integer."
        );
        index += 1;
        break;
      case "--problem":
        options.problem = takeValue(argv, index, "Missing value for --problem.");
        index += 1;
        break;
      case "--expected-output":
        options.expectedOutput = takeValue(argv, index, "Missing value for --expected-output.");
        index += 1;
        break;
      case "--command-policy":
        options.commandPolicyPath = takeValue(argv, index, "Missing value for --command-policy.");
        index += 1;
        break;
      case "--sandbox-policy":
        options.sandboxPolicyPath = takeValue(argv, index, "Missing value for --sandbox-policy.");
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

function parseReplay(argv) {
  const options = { command: "replay", runner: "docker" };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--log":
        options.logPath = takeValue(argv, index, "Missing --log value.");
        index += 1;
        break;
      case "--candidate-id":
        options.candidateId = takeValue(argv, index, "Missing value for --candidate-id.");
        index += 1;
        break;
      case "--attempt-id":
        options.attemptId = takeValue(argv, index, "Missing value for --attempt-id.");
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
      case "--expected-output":
        options.expectedOutput = takeValue(argv, index, "Missing value for --expected-output.");
        index += 1;
        break;
      case "--time-budget":
        options.timeBudgetMs = parseNumber(
          takeValue(argv, index, "Missing value for --time-budget."),
          "Invalid --time-budget value. Use a positive integer."
        );
        index += 1;
        break;
      case "--command-policy":
        options.commandPolicyPath = takeValue(argv, index, "Missing value for --command-policy.");
        index += 1;
        break;
      case "--sandbox-policy":
        options.sandboxPolicyPath = takeValue(argv, index, "Missing value for --sandbox-policy.");
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

function parseLogs(argv) {
  const subcommand = argv[1];
  if (subcommand === "show") {
    const logRef = argv[2];
    if (!logRef) {
      throw new Error("Missing <run-id> argument.");
    }
    return { command: "logs-show", logRef };
  }

  throw new Error(`Unsupported logs subcommand: ${subcommand ?? "(missing)"}`);
}

export function createCliProgram() {
  const helpText = [
    "Usage:",
    "  shellgeiai solve <problem> [options]",
    "  shellgeiai check <command> [options]",
    "  shellgeiai replay --log <path> [options]",
    "  shellgeiai logs show <run-id>",
    "",
    "Solve options:",
    "  --engine <engine>",
    "  --runner <runner>",
    "  --max-iter <number>",
    "  --workdir <path>",
    "  --mode <mode>",
    "  --parallelism <number>",
    "  --selector <name>",
    "  --shellgei-score-mode <mode>",
    "  --time-budget <ms>",
    "  --command-policy <path>",
    "  --sandbox-policy <path>",
    "  --progress <mode>"
  ].join("\n");

  return {
    helpInformation() {
      return helpText;
    }
  };
}

export function parseCliOptions(argv) {
  const command = argv[0];

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
