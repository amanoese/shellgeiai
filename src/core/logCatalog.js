import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { readJson } from "../util/fs.js";

function getDefaultLogsDir() {
  return path.join(process.cwd(), "logs");
}

function inferMode(filename, payload) {
  if (typeof payload.mode === "string" && payload.mode.length > 0) {
    return payload.mode;
  }

  if (filename.startsWith("solve-")) {
    return "solve";
  }

  if (filename.startsWith("check-")) {
    return "check";
  }

  if (filename.startsWith("replay-")) {
    return "replay";
  }

  return "unknown";
}

function summarizeLog(filename, logPath, payload, fileStat) {
  const command =
    payload.command ??
    payload.candidates?.[0]?.command ??
    payload.replayTarget?.command ??
    payload.attempts?.[0]?.command ??
    "";

  return {
    logId: path.basename(filename, ".json"),
    filename,
    logPath,
    mode: inferMode(filename, payload),
    sessionId: payload.sessionId ?? null,
    startedAt: payload.startedAt ?? null,
    finishedAt: payload.finishedAt ?? null,
    problem: payload.problem ?? payload.problemSpec?.problemText ?? "",
    command,
    selectedCandidateId: payload.selectedCandidateId ?? null,
    passed: payload.finalCheck?.passed ?? null,
    mtimeMs: fileStat.mtimeMs
  };
}

function sortLogsDescending(left, right) {
  const leftKey = Date.parse(left.finishedAt ?? left.startedAt ?? "") || left.mtimeMs;
  const rightKey = Date.parse(right.finishedAt ?? right.startedAt ?? "") || right.mtimeMs;

  if (leftKey !== rightKey) {
    return rightKey - leftKey;
  }

  return right.filename.localeCompare(left.filename);
}

async function loadLogSummaries(logsDir) {
  let entries;
  try {
    entries = await readdir(logsDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const logPath = path.join(logsDir, entry.name);
        const [payload, fileStat] = await Promise.all([readJson(logPath), stat(logPath)]);
        return summarizeLog(entry.name, logPath, payload, fileStat);
      })
  );

  return summaries.sort(sortLogsDescending);
}

export async function listSavedLogs({ logsDir = getDefaultLogsDir(), limit } = {}) {
  const summaries = await loadLogSummaries(logsDir);
  return typeof limit === "number" ? summaries.slice(0, limit) : summaries;
}

export async function searchSavedLogs({ query, logsDir = getDefaultLogsDir(), mode, passed, limit } = {}) {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const summaries = await loadLogSummaries(logsDir);
  const filtered = summaries.filter((summary) => {
    if (mode != null && summary.mode !== mode) {
      return false;
    }

    if (passed != null && summary.passed !== passed) {
      return false;
    }

    if (normalizedQuery.length === 0) {
      return true;
    }

    const haystack = [
      summary.logId,
      summary.filename,
      summary.problem,
      summary.command,
      summary.selectedCandidateId ?? ""
    ]
      .join("\n")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}

export async function pruneSavedLogs({ logsDir = getDefaultLogsDir(), retainDays, now = new Date(), dryRun = false }) {
  if (!Number.isFinite(retainDays) || retainDays < 0) {
    throw new Error("retainDays must be a non-negative number.");
  }

  const cutoffAt = new Date(now.getTime() - retainDays * 24 * 60 * 60 * 1000);
  const summaries = await loadLogSummaries(logsDir);
  const deleted = [];
  const kept = [];

  for (const summary of summaries) {
    const referenceTime = Date.parse(summary.finishedAt ?? summary.startedAt ?? "") || summary.mtimeMs;
    if (referenceTime < cutoffAt.getTime()) {
      deleted.push(summary);
      if (!dryRun) {
        await rm(summary.logPath, { force: true });
      }
      continue;
    }

    kept.push(summary);
  }

  return {
    cutoffAt: cutoffAt.toISOString(),
    deleted,
    kept,
    deletedCount: deleted.length,
    keptCount: kept.length
  };
}
