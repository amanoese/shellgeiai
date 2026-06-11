import { pruneSavedLogs } from "../../core/logCatalog.js";
import { formatPruneResult } from "../../formatter/logCatalog.js";

export async function runLogsPruneCommand(options) {
  const result = await pruneSavedLogs({
    retainDays: options.retainDays,
    dryRun: options.dryRun
  });

  process.stdout.write(`${formatPruneResult(result)}\n`);
  process.exitCode = 0;
}
