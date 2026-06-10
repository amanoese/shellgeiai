import { runSolveOrchestrator } from "./orchestrator.js";
import { selectSolveOutcome } from "./selector.js";
import { createSolveSession } from "./solveSession.js";
import { writeSolveSessionLog } from "../logs/writer.js";

export async function solveProblem(options) {
  const session = await createSolveSession(options);
  const execution = await runSolveOrchestrator(session);
  return await finalizeSolve(session, execution);
}

async function finalizeSolve(session, execution) {
  const finishedAt = new Date().toISOString();
  const selection = selectSolveOutcome(execution.candidates, session.selectorName);
  const selectedCandidate = selection.selectedCandidate;
  const finalCheck = selectedCandidate?.finalCheck ?? {
    passed: false,
    iterations: execution.attempts.length,
    engine: session.engine.name,
    reason: "No candidate was produced.",
    score: null
  };
  const { logPath } = await writeSolveSessionLog({
    logsDir: session.logsDir,
    session,
    summary: {
      finishedAt,
      selectedCandidateId: selectedCandidate?.candidateId ?? null,
      stopReason: execution.stopReason
    },
    attempts: execution.attempts,
    candidates: execution.candidates,
    finalCheck
  });

  return {
    command: selectedCandidate?.command ?? "",
    output: selectedCandidate?.output ?? "",
    explanation: selectedCandidate?.explanation ?? "No explanation provided.",
    attempts: execution.attempts,
    candidates: execution.candidates,
    finalCheck,
    selector: {
      name: selection.selector,
      reason: selection.reason,
      selectedCandidateId: selectedCandidate?.candidateId ?? null,
      score: selection.score,
      metrics: selection.metrics
    },
    runner: {
      name: session.runner.name ?? "local",
      limits: session.runnerLimits,
      sandboxPolicy: session.sandboxPolicy
    },
    stopReason: execution.stopReason,
    plan: session.plan,
    workdir: session.workdir,
    problem: session.problem,
    logPath
  };
}
