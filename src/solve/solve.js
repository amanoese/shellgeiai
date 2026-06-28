import { writeSolveSessionLog } from "../io/logs/writer.js";
import { runSolveOrchestrator } from "../core/orchestrator.js";
import { scoreShellgeiCandidate } from "../core/shellgeiScorer.js";
import { selectSolveOutcome } from "../core/selector.js";
import { reportSessionPhase } from "./session/progress.js";
import { createSolveSession } from "./session/solveSession.js";

export async function solveProblem(options) {
  const session = await createSolveSession(options);
  const execution = await runSolveOrchestrator(session);
  return await finalizeSolve(session, execution);
}

async function finalizeSolve(session, execution) {
  reportSessionPhase(session, "selecting", "Selecting final candidate.");

  const finishedAt = new Date().toISOString();
  const candidates = execution.candidates.map((candidate) =>
    candidate.finalCheck?.passed
      ? {
          ...candidate,
          shellgeiScore: scoreShellgeiCandidate(candidate, { mode: session.shellgeiScoreMode })
        }
      : candidate
  );
  const selection = selectSolveOutcome(candidates, session.selectorName);
  const selectedCandidate = selection.selectedCandidate;
  const finalCheck = selectedCandidate?.finalCheck ?? {
    passed: false,
    iterations: execution.attempts.length,
    engine: session.engine.name,
    reason: "No candidate was produced.",
    score: null
  };

  reportSessionPhase(session, "logging", "Writing session log.");
  const { logPath } = await writeSolveSessionLog({
    logsDir: session.logsDir,
    session,
    summary: {
      finishedAt,
      selectedCandidateId: selectedCandidate?.candidateId ?? null,
      stopReason: execution.stopReason,
      workerSummaries: execution.workerSummaries,
      selectorReason: selection.reason,
      selectorScore: selection.score,
      selectorMetrics: selection.metrics
    },
    attempts: execution.attempts,
    candidates,
    workerSummaries: execution.workerSummaries,
    finalCheck
  });

  reportSessionPhase(session, "completed", "Solve completed.");
  return {
    command: selectedCandidate?.command ?? "",
    output: selectedCandidate?.output ?? "",
    explanation: selectedCandidate?.explanation ?? "No explanation provided.",
    attempts: execution.attempts,
    candidates,
    workerSummaries: execution.workerSummaries,
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
      sandboxPolicy: session.sandboxPolicy,
      writableWorkdir: session.writableWorkdir
    },
    stopReason: execution.stopReason ?? null,
    workdir: session.workdir,
    problem: session.problem,
    logPath,
    plan: session.plan
  };
}
