import { runSolveOrchestrator } from "./orchestrator.js";
import { scoreShellgeiCandidate } from "./shellgeiScorer.js";
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
  const candidates = execution.candidates.map((candidate) =>
    candidate.finalCheck?.passed
      ? {
          ...candidate,
          shellgeiScore: scoreShellgeiCandidate(candidate)
        }
      : candidate
  );
  const selection = selectSolveOutcome(candidates, session.selectorName);
  const selectedCandidate = selection.selectedCandidate;
  const finalCheck = await resolveFinalCheck(session, selectedCandidate) ?? {
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
      image: "image" in session.runner ? session.runner.image : undefined,
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

async function resolveFinalCheck(session, selectedCandidate) {
  if (!selectedCandidate) {
    return null;
  }

  if (session.selectorName !== "best-score-wins") {
    return selectedCandidate.finalCheck;
  }

  const finalAttempt = selectedCandidate.attempts.at(-1);
  if (!finalAttempt) {
    return selectedCandidate.finalCheck;
  }

  const decision = await session.judge.judge({
    command: finalAttempt.command ?? selectedCandidate.command,
    stdout: finalAttempt.stdout ?? "",
    stderr: finalAttempt.stderr ?? "",
    exitCode: finalAttempt.exitCode ?? null,
    timedOut: finalAttempt.timedOut ?? false,
    expectedOutput: session.problem.expectedOutput
  });

  return {
    passed: decision.passed,
    iterations: selectedCandidate.finalCheck.iterations ?? selectedCandidate.attempts.length,
    engine: selectedCandidate.finalCheck.engine ?? session.engine.name,
    reason: decision.reason,
    score: decision.score
  };
}
