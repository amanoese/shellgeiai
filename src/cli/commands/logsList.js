import { listSavedLogs } from "../../core/logCatalog.js";
import { formatLogSummaries } from "../../formatter/logCatalog.js";

export async function runLogsListCommand(options) {
  const logs = await listSavedLogs({
    limit: options.limit
  });

  process.stdout.write(`${formatLogSummaries(logs, "LOGS:")}\n`);
  process.exitCode = 0;
}
