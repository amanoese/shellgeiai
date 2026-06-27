export function parseLogs(argv) {
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
