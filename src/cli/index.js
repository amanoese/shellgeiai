import { createCliProgram } from "./program.js";

export async function runCli(argv) {
  const program = createCliProgram();

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (
      error?.code === "commander.helpDisplayed" ||
      error?.code === "commander.help"
    ) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}
