import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { readJson } from "../../shared/fs.js";

function getDefaultLogsDir() {
  return path.join(process.cwd(), "logs");
}

function hasPathSyntax(logRef) {
  return logRef.includes("/") || logRef.includes("\\") || logRef.endsWith(".json");
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

  return "unknown";
}

function summarizeLog(filename, logPath, payload, fileStat) {
  const command = payload.command ?? payload.candidates?.[0]?.command ?? payload.attempts?.[0]?.command ?? "";

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

async function resolveLogPath(logRef) {
  if (hasPathSyntax(logRef)) {
    return path.resolve(process.cwd(), logRef);
  }

  const logsDir = getDefaultLogsDir();
  const entries = await readdir(logsDir, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .filter(
      (name) => name === logRef || name === `${logRef}.json` || name.endsWith(`-${logRef}.json`)
    );

  if (matches.length === 0) {
    throw new Error(`No saved log matched '${logRef}' in ${logsDir}.`);
  }

  if (matches.length > 1) {
    throw new Error(`Multiple saved logs matched '${logRef}'. Please pass full filename or path.`);
  }

  return path.join(logsDir, matches[0]);
}

function buildFallbackFinalCheck(log, command) {
  return (
    log.finalCheck ?? {
      passed: false,
      iterations: Array.isArray(log.attempts) ? log.attempts.length : 0,
      engine: log.engine ?? log.mode ?? "unknown",
      reason: command ? "Saved log did not contain final check." : "Saved log did not contain a result.",
      score: null
    }
  );
}

function buildSelector(log, selectedCandidate, finalCheck, logPath) {
  const loadedReason = `Loaded saved log ${logPath}.`;

  if (log.selector && typeof log.selector === "object") {
    return {
      name: log.selector.name ?? "first-pass-wins",
      reason: log.selector.reason ?? loadedReason,
      selectedCandidateId: log.selector.selectedCandidateId ?? selectedCandidate?.candidateId ?? null,
      score: log.selector.score ?? selectedCandidate?.finalCheck?.score ?? finalCheck.score ?? null,
      metrics: log.selector.metrics ?? null
    };
  }

  return {
    name: "first-pass-wins",
    reason: loadedReason,
    selectedCandidateId: selectedCandidate?.candidateId ?? null,
    score: selectedCandidate?.finalCheck?.score ?? finalCheck.score ?? null,
    metrics: null
  };
}

function restoreResultFromLog(log, logPath) {
  const selectedCandidateId = log.selector?.selectedCandidateId ?? log.selectedCandidateId ?? null;
  const selectedCandidate =
    (log.candidates ?? []).find((candidate) => candidate.candidateId === selectedCandidateId) ??
    (log.candidates ?? [])[0] ??
    null;
  const command = selectedCandidate?.command ?? log.command ?? "";
  const output = selectedCandidate?.output ?? log.output ?? "";
  const explanation =
    selectedCandidate?.explanation ??
    log.explanation ??
    log.attempts?.[0]?.explanation ??
    "Loaded a saved session log.";
  const finalCheck = selectedCandidate?.finalCheck ?? buildFallbackFinalCheck(log, command);

  return {
    command,
    output,
    explanation,
    attempts: log.attempts ?? selectedCandidate?.attempts ?? [],
    candidates: log.candidates ?? (selectedCandidate ? [selectedCandidate] : []),
    finalCheck,
    selector: buildSelector(log, selectedCandidate, finalCheck, logPath),
    runner: log.runner ?? { name: "local", limits: {}, sandboxPolicy: {} },
    stopReason: log.stopReason ?? null,
    plan: log.plan ?? log.planner ?? null,
    workdir: log.workdir ?? "",
    problem:
      log.problemSpec ??
      {
        raw: log.rawProblem ?? log.problem ?? "",
        problemText: log.problem ?? log.rawProblem ?? "",
        metadata: { format: "plain-text" }
      },
    logPath
  };
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

export async function pruneSavedLogs({
  logsDir = getDefaultLogsDir(),
  retainDays,
  now = new Date(),
  dryRun = false
}) {
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
    } else {
      kept.push(summary);
    }
  }

  return {
    cutoffAt: cutoffAt.toISOString(),
    deleted,
    kept,
    deletedCount: deleted.length,
    keptCount: kept.length,
    dryRun
  };
}

export async function showSavedLog(logRef) {
  const logPath = await resolveLogPath(logRef);
  const log = await readJson(logPath);
  return restoreResultFromLog(log, logPath);
}
