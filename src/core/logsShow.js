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
      reason: command
        ? "Saved log did not contain final check."
        : "Saved log did not contain a replayable result.",
      score: null
    }
  );
}

function buildSelector(log, selectedCandidate, finalCheck, logPath) {
  const replayReason =
    log.mode === "replay" && (log.sourceSelectedCandidateId || log.selectedCandidateId)
      ? `Loaded candidate selected in the source log ${log.sourceLogPath ?? logPath}.`
      : `Loaded saved log ${logPath}.`;

  if (log.selector && typeof log.selector === "object") {
    return {
      name: log.selector.name ?? "first-pass-wins",
      reason: log.selector.reason ?? replayReason,
      selectedCandidateId: log.selector.selectedCandidateId ?? selectedCandidate?.candidateId ?? null,
      score: log.selector.score ?? selectedCandidate?.finalCheck?.score ?? finalCheck.score ?? null,
      metrics: log.selector.metrics ?? null
    };
  }

  return {
    name: "first-pass-wins",
    reason: replayReason,
    selectedCandidateId: selectedCandidate?.candidateId ?? null,
    score: selectedCandidate?.finalCheck?.score ?? finalCheck.score ?? null,
    metrics: null
  };
}

function restoreResultFromLog(log, logPath) {
  const selectedCandidateId =
    log.selector?.selectedCandidateId ?? log.selectedCandidateId ?? log.sourceSelectedCandidateId ?? null;
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
    attempts: log.attempts ?? [],
    candidates: log.candidates ?? [],
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

export async function showSavedLog(logRef) {
  const logPath = await resolveLogPath(logRef);
  const log = await readJson(logPath);

  return restoreResultFromLog(log, logPath);
}
