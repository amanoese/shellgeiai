import { writeFile } from "node:fs/promises";
import path from "node:path";

async function writeSessionLog(logsDir, prefix, startedAt, payload) {
  const logId = startedAt.replace(/[:.]/g, "-");
  let sequence = 0;
  const content = `${JSON.stringify(payload, null, 2)}\n`;

  while (true) {
    const suffix = sequence === 0 ? "" : `-${sequence + 1}`;
    const filename = `${prefix}-${logId}${suffix}.json`;
    const logPath = path.join(logsDir, filename);

    try {
      await writeFile(logPath, content, { encoding: "utf8", flag: "wx" });
      return {
        logId: `${logId}${suffix}`,
        logPath
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        sequence += 1;
        continue;
      }

      throw error;
    }
  }
}

export async function writeSolveSessionLog({ logsDir, session, summary, attempts, candidates, workerSummaries, finalCheck }) {
  return await writeSessionLog(logsDir, "solve", summary.finishedAt, {
    sessionId: session.sessionId,
    problem: session.problem.problemText,
    rawProblem: session.problem.raw,
    problemSpec: session.problem,
    engine: session.engine.name,
    iterations: attempts.length,
    attempts,
    candidates,
    workerSummaries: workerSummaries ?? [],
    finalCheck,
    selectedCandidateId: summary.selectedCandidateId,
    stopReason: summary.stopReason ?? null,
    selector:
      summary.selectedCandidateId == null
        ? {
            name: session.selectorName,
            reason: "No candidate was selected.",
            selectedCandidateId: null,
            score: null,
            metrics: null
          }
        : {
            name: session.selectorName,
            reason: summary.selectorReason ?? "Selector details were not captured.",
            selectedCandidateId: summary.selectedCandidateId,
            score: summary.selectorScore ?? null,
            metrics: summary.selectorMetrics ?? null
          },
    startedAt: session.startedAt,
    finishedAt: summary.finishedAt,
    workdir: session.workdir,
    planner: session.plan,
    runner: {
      name: session.runner.name ?? "local",
      image: "image" in session.runner ? session.runner.image : undefined,
      limits: session.runnerLimits,
      sandboxPolicy: session.sandboxPolicy
    }
  });
}

export async function writeCheckSessionLog({ logsDir, session, result }) {
  return await writeSessionLog(logsDir, "check", session.startedAt, {
    sessionId: session.sessionId,
    mode: "check",
    problem: session.problemText,
    rawProblem: session.problemText,
    problemSpec: {
      raw: session.problemText,
      problemText: session.problemText,
      expectedOutput: session.expectedOutput,
      metadata: {
        format: "plain-text"
      }
    },
    command: result.command,
    attempts: result.attempts,
    candidates: result.candidates,
    finalCheck: result.finalCheck,
    selectedCandidateId: result.candidates[0]?.candidateId ?? null,
    stopReason: result.stopReason,
    startedAt: session.startedAt,
    finishedAt: new Date().toISOString(),
    workdir: session.workdir,
    runner: {
      name: session.runner.name ?? "local",
      image: "image" in session.runner ? session.runner.image : undefined,
      limits: session.runnerLimits,
      sandboxPolicy: session.sandboxPolicy
    }
  });
}

export async function writeReplaySessionLog({ logsDir, session, result }) {
  return await writeSessionLog(logsDir, "replay", session.startedAt, {
    sessionId: session.sessionId,
    mode: "replay",
    problem: session.problem.problemText,
    rawProblem: session.problem.raw,
    problemSpec: session.problem,
    sourceLogPath: session.sourceLogPath,
    sourceSelectedCandidateId: session.sourceSelectedCandidateId,
    replayTarget: session.replayTarget,
    attempts: result.attempts,
    candidates: result.candidates,
    finalCheck: result.finalCheck,
    selectedCandidateId: result.candidates[0]?.candidateId ?? null,
    stopReason: result.stopReason,
    startedAt: session.startedAt,
    finishedAt: new Date().toISOString(),
    workdir: session.workdir,
    runner: {
      name: session.runner.name ?? "local",
      image: "image" in session.runner ? session.runner.image : undefined,
      limits: session.runnerLimits,
      sandboxPolicy: session.sandboxPolicy
    }
  });
}
