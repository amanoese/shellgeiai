import { searchSavedLogs } from "../../core/logCatalog.js";
import { formatLogSummaries } from "../../formatter/logCatalog.js";

export async function runLogsSearchCommand(options) {
  const logs = await searchSavedLogs({
    query: options.query,
    mode: options.mode,
    passed: options.passed,
    limit: options.limit
  });

  process.stdout.write(
    `${formatLogSummaries(logs, `LOGS MATCHING: ${options.query}`)}\n`
  );
  process.exitCode = 0;
}
