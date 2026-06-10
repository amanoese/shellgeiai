import path from "node:path";
import { writeJson } from "../util/fs.js";

export async function writeSolveSessionLog({ logsDir, session, summary, attempts, candidates, finalCheck }) {
  const logId = summary.finishedAt.replace(/[:.]/g, "-");
  const logPath = path.join(logsDir, `solve-${logId}.json`);

  await writeJson(logPath, {
    sessionId: session.sessionId,
    problem: session.problem.problemText,
    rawProblem: session.problem.raw,
    engine: session.engine.name,
    iterations: attempts.length,
    attempts,
    candidates,
    finalCheck,
    selectedCandidateId: summary.selectedCandidateId,
    stopReason: summary.stopReason ?? null,
    selector: session.selectorName,
    startedAt: session.startedAt,
    finishedAt: summary.finishedAt,
    workdir: session.workdir,
    planner: session.plan,
    runner: {
      name: session.runner.name ?? "local",
      limits: session.runnerLimits,
      sandboxPolicy: session.sandboxPolicy
    }
  });

  return {
    logId,
    logPath
  };
}
