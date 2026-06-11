import { formatResult } from "../../formatter/formatResult.js";
import { showSavedLog } from "../../core/logsShow.js";

export async function runLogsShowCommand(options) {
  const result = await showSavedLog(options.logRef);
  process.stdout.write(`${formatResult(result)}\n`);
  process.exitCode = result.finalCheck.passed ? 0 : 1;
}
