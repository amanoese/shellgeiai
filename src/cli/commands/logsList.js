import { listSavedLogs } from "../../io/logs/catalog.js";
import { formatLogSummaries } from "../../io/formatter/logs.js";

export async function runLogsListCommand(options) {
  const logs = await listSavedLogs({
    limit: options.limit
  });

  process.stdout.write(`${formatLogSummaries(logs, "LOGS:")}\n`);
  process.exitCode = 0;
}
