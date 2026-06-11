import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJson } from "../util/fs.js";

function hasPathSyntax(logRef) {
  return logRef.includes("/") || logRef.includes("\\") || logRef.endsWith(".json");
}

async function resolveLogPath(logRef) {
  if (hasPathSyntax(logRef)) {
    return path.resolve(process.cwd(), logRef);
  }

  const logsDir = path.join(process.cwd(), "logs");
  const entries = await readdir(logsDir, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .filter((name) => name === logRef || name === `${logRef}.json` || name.endsWith(`-${logRef}.json`));

  if (matches.length === 0) {
    throw new Error(`No saved log matched '${logRef}' in ${logsDir}.`);
  }

  if (matches.length > 1) {
    throw new Error(`Multiple saved logs matched '${logRef}'. Please pass a full filename or path.`);
  }

  return path.join(logsDir, matches[0]);
}

function buildFallbackFinalCheck(log, command, output) {
  return (
    log.finalCheck ?? {
      passed: false,
      iterations: Array.isArray(log.attempts) ? log.attempts.length : 0,
      engine: log.engine ?? log.mode ?? "unknown",
      reason: command ? "Saved log did not contain a final check." : "Saved log did not contain a replayable result.",
      score: null
    }
  );
}

function buildSelector(log, selectedCandidate, finalCheck, logPath) {
  if (log.selector && typeof log.selector === "object") {
    return {
      name: log.selector.name ?? "first-pass-wins",
      reason: log.selector.reason ?? `Loaded saved log ${logPath}.`,
      selectedCandidateId: log.selector.selectedCandidateId ?? selectedCandidate?.candidateId ?? null,
      score: log.selector.score ?? selectedCandidate?.finalCheck?.score ?? finalCheck.score ?? null,
      metrics: log.selector.metrics ?? null
    };
  }

  const selectorName =
    log.mode === "check" ? "manual-check" : log.mode === "replay" ? "replay" : log.selector ?? "first-pass-wins";
  const selectorReason =
    log.mode === "check"
      ? "Loaded a saved explicit command check."
      : log.mode === "replay"
        ? `Loaded a saved replay run from ${log.sourceLogPath ?? "an earlier log"}.`
        : "Loaded the saved solve result.";

  return {
    name: selectorName,
    reason: selectorReason,
    selectedCandidateId: selectedCandidate?.candidateId ?? log.selectedCandidateId ?? null,
    score: selectedCandidate?.finalCheck?.score ?? finalCheck.score ?? null,
    metrics: null
  };
}

function restoreResultFromLog(log, logPath) {
  const selectedCandidate =
    log.candidates?.find((candidate) => candidate.candidateId === log.selectedCandidateId) ?? log.candidates?.[0] ?? null;
  const command =
    log.command ??
    selectedCandidate?.command ??
    log.replayTarget?.command ??
    log.attempts?.[0]?.command ??
    "";
  const output =
    log.output ??
    selectedCandidate?.output ??
    log.attempts?.[0]?.stdout?.trim?.() ??
    "";
  const explanation =
    log.explanation ??
    selectedCandidate?.explanation ??
    log.replayTarget?.explanation ??
    log.attempts?.[0]?.explanation ??
    "Loaded a saved session log.";
  const finalCheck = selectedCandidate?.finalCheck ?? buildFallbackFinalCheck(log, command, output);

  return {
    command,
    output,
    explanation,
    attempts: log.attempts ?? [],
    candidates: log.candidates ?? [],
    finalCheck,
    selector: buildSelector(log, selectedCandidate, finalCheck, logPath),
    runner: log.runner ?? {
      name: "local",
      limits: {},
      sandboxPolicy: {}
    },
    stopReason: log.stopReason ?? null,
    plan: log.planner,
    workdir: log.workdir ?? "",
    problem:
      log.problemSpec ?? {
        raw: log.rawProblem ?? log.problem ?? "",
        problemText: log.problem ?? log.rawProblem ?? "",
        metadata: {
          format: "plain-text"
        }
      },
    logPath
  };
}

export async function showSavedLog(logRef) {
  const logPath = await resolveLogPath(logRef);
  const log = await readJson(logPath);
  return restoreResultFromLog(log, logPath);
}
