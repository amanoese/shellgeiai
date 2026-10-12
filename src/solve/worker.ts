import type {
  SolveSession,
  WorkerTask,
  ExecutionControl,
  WorkerState,
  WorkerPhase,
  WorkerResult,
  SolveAttempt,
  WorkerAttemptOutcome,
  EngineResult,
  RunResult,
  ProblemSpec,
  JudgeDecision,
  JudgeInput,
  JudgeScore,
  ToolCallSummary,
  WorkerCandidate,
  WorkerSummary,
  CandidateFinalCheck
} from "../types.js";
import { reportSolveProgress } from "./events.js";
import { isSafeCommand } from "../execution/safety/checker.js";
import { generateWorkerCommand, WorkerToolLoopError } from "./tools.js";

type FailedAttempt = SolveAttempt & { passed: false };
interface AttemptInput {
  task: WorkerTask;
  iteration: number;
  command: string;
  explanation?: string;
  reason: string;
  toolCalls?: ToolCallSummary[];
}
interface WorkerAttemptInput {
  session: SolveSession;
  task: WorkerTask;
  control: ExecutionControl;
  workerState: WorkerState;
  iteration: number;
  attempts: SolveAttempt[];
}
interface CancellationInput {
  error: unknown;
  signal: AbortSignal;
  session: SolveSession;
  control: ExecutionControl;
}
interface StoppedGenerationInput {
  session: SolveSession;
  task: WorkerTask;
  workerState: WorkerState;
  reason: string;
  engineResult?: EngineResult;
}

function reportWorkerState(session: SolveSession, task: WorkerTask, state: WorkerPhase) {
  reportSolveProgress(session, {
    type: "worker-state",
    workerId: task.workerId,
    strategy: task.strategy,
    state
  });
}

export async function executeWorkerTask(session: SolveSession, task: WorkerTask, control: ExecutionControl, workerState: WorkerState): Promise<WorkerResult> {
  const attempts: SolveAttempt[] = [];
  let lastExplanation = "";
  let stopReason = "";
  let finalState: WorkerPhase = "idle";
  reportSolveProgress(session, {
    type: "worker-started",
    workerId: task.workerId,
    strategy: task.strategy,
    maxAttempts: task.maxAttempts
  });
  for (let iteration = 0; iteration < task.maxAttempts; iteration += 1) {
    const preflightStopReason = getWorkerStopReason(session, control);
    if (preflightStopReason) {
      stopReason = preflightStopReason;
      reportWorkerState(session, task, "stopped");
      finalState = "stopped";
      break;
    }
    const result = await runWorkerAttempt({
      session,
      task,
      control,
      workerState,
      iteration,
      attempts
    });
    lastExplanation = (result.kind === "stopped" ? result.explanation : result.attempt.explanation) ?? lastExplanation;
    if (result.attempt) attempts.push(result.attempt);
    switch (result.kind) {
      case "passed":
        if (session.selectorName === "first-pass-wins") {
          control.scheduleGraceStop({
            reason: "Stopped after first passing candidate was produced.",
            passingCandidateId: task.workerId,
            exceptWorkerId: task.workerId,
            force: true
          }, 5000);
        } else {
          control.passingCandidateId ??= task.workerId;
        }
        finalState = "idle";
        break;
      case "retry":
        finalState = "idle";
        continue;
      case "stopped":
        finalState = "stopped";
        stopReason = result.reason;
        break;
      default: {
        const unreachable: never = result;
        return unreachable;
      }
    }
    break;
  }
  const finalAttempt = attempts.at(-1);
  const finalReason = finalAttempt?.passed
    ? finalAttempt.failureReason
    : stopReason ||
    finalAttempt?.failureReason ||
    (session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs
      ? "Time budget was exhausted before successful attempt completed."
      : "No successful attempt.");
  const candidate = createWorkerCandidate({
    task,
    attempts,
    finalAttempt,
    finalReason,
    lastExplanation,
    engineName: session.engine.name
  });
  const finalCheck = candidate.finalCheck;
  const workerSummary = createWorkerSummary({ task, attempts, finalCheck, finalState });
  reportSolveProgress(session, {
    type: "worker-finished",
    workerId: task.workerId,
    strategy: task.strategy,
    attemptCount: attempts.length,
    passed: finalCheck.passed,
    reason: finalCheck.reason
  });
  return {
    attempts,
    candidate,
    workerSummary
  };
}

function reportAttemptFinished(session: SolveSession, task: WorkerTask, iteration: number, command: string, passed: boolean, reason: string) {
  reportSolveProgress(session, {
    type: "attempt-finished",
    workerId: task.workerId,
    strategy: task.strategy,
    iteration: iteration + 1,
    command,
    passed,
    reason
  });
}

function getRoutineCancellationReason({ error, signal, session, control }: CancellationInput): string {
  const errorName = error !== null && (typeof error === "object" || typeof error === "function") && "name" in error
    ? error.name : undefined;
  if (!signal.aborted || (error !== signal.reason && errorName !== "AbortError" && errorName !== "APIUserAbortError"))
    return "";
  const deadlineExceeded = session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs;
  // An external session cancellation is an exception; scheduler/deadline stops preserve candidates.
  if (session.signal?.aborted && !deadlineExceeded)
    return "";
  return getWorkerStopReason(session, control) || "Execution was stopped.";
}

function throwIfExternalSessionAborted(session: SolveSession) {
  if (session.signal?.aborted && (session.deadlineAtMs == null || Date.now() < session.deadlineAtMs))
    session.signal.throwIfAborted();
}

function createStoppedGenerationResult({ session, task, workerState, reason, engineResult }: StoppedGenerationInput): WorkerAttemptOutcome<SolveAttempt> {
  workerState.phase = "idle";
  reportWorkerState(session, task, "stopped");
  return {
    kind: "stopped",
    attempt: null,
    reason,
    explanation: engineResult?.explanation ?? ""
  };
}

export async function runWorkerAttempt({ session, task, control, workerState, iteration, attempts }: WorkerAttemptInput): Promise<WorkerAttemptOutcome<SolveAttempt>> {
  const signal = session.signal
    ? AbortSignal.any([workerState.abortController.signal, session.signal])
    : workerState.abortController.signal;
  workerState.phase = "planning";
  reportWorkerState(session, task, "planning");
  const context = {
    problem: session.problem.problemText,
    attempts,
    workdir: session.workdir,
    workerId: task.workerId,
    strategy: task.strategy,
    workerTask: task
  };
  let generated;
  try {
    generated = await generateWorkerCommand({
      engine: session.engine,
      context,
      toolRegistry: session.toolRegistry,
      signal
    });
  }
  catch (error) {
    const cancellationReason = getRoutineCancellationReason({ error, signal, session, control });
    if (cancellationReason) {
      return createStoppedGenerationResult({ session, task, workerState, reason: cancellationReason });
    }
    if (!(error instanceof WorkerToolLoopError)) {
      throw error;
    }
    const attempt = createGenerationFailedAttempt({
      task,
      iteration,
      reason: error.message,
      toolCalls: error.toolCalls
    });
    workerState.phase = "idle";
    reportWorkerState(session, task, "idle");
    reportAttemptFinished(session, task, iteration, "", false, error.message);
    return { kind: "retry", attempt };
  }
  const { engineResult, toolCalls } = generated;
  reportSolveProgress(session, {
    type: "attempt-started",
    workerId: task.workerId,
    strategy: task.strategy,
    iteration: iteration + 1,
    command: engineResult.command
  });
  const safety = await isSafeCommand(engineResult.command, session.commandPolicy);
  if (!safety.safe) {
    reportWorkerState(session, task, "stopped");
    const attempt = createUnsafeAttempt({
      task,
      iteration,
      command: engineResult.command,
      explanation: engineResult.explanation,
      reason: safety.reason,
      toolCalls
    });
    reportAttemptFinished(session, task, iteration, engineResult.command, false, safety.reason);
    return { kind: "stopped", attempt, reason: safety.reason, explanation: engineResult.explanation };
  }
  const remainingBudgetMs = getRemainingBudgetMs(session);
  if (signal.aborted) {
    const cancellationReason = getRoutineCancellationReason({ error: signal.reason, signal, session, control });
    if (cancellationReason) {
      return createStoppedGenerationResult({ session, task, workerState, reason: cancellationReason, engineResult });
    }
    signal.throwIfAborted();
  }
  if (remainingBudgetMs != null && remainingBudgetMs <= 0) {
    const stopReason = getWorkerStopReason(session, control);
    reportWorkerState(session, task, "stopped");
    return { kind: "stopped", attempt: null, reason: stopReason, explanation: engineResult.explanation };
  }
  try {
    workerState.phase = "running";
    workerState.iteration = iteration + 1;
    workerState.command = engineResult.command;
    reportWorkerState(session, task, "running");
    const runResult = await session.runner.run(engineResult.command, {
      cwd: session.workdir,
      timeoutMs: remainingBudgetMs,
      limits: session.runnerLimits,
      sandboxPolicy: session.sandboxPolicy,
      dockerDevicesReadonly: session.dockerDevicesReadonly,
      signal
    });
    throwIfExternalSessionAborted(session);
    if (runResult.aborted) {
      const abortedReason = getWorkerStopReason(session, control) || "Execution was stopped.";
      reportWorkerState(session, task, "stopped");
      const attempt = createAbortedAttempt({
        task,
        iteration,
        command: engineResult.command,
        runResult,
        explanation: engineResult.explanation,
        reason: abortedReason,
        toolCalls
      });
      reportAttemptFinished(session, task, iteration, engineResult.command, false, abortedReason);
      return { kind: "stopped", attempt, reason: abortedReason, explanation: engineResult.explanation };
    }
    workerState.phase = "judging";
    reportWorkerState(session, task, "judging");
    const decision = await session.judge.judge(buildJudgeInput(engineResult.command, runResult, session.problem));
    const attempt = createJudgedAttempt({
      task,
      iteration,
      command: engineResult.command,
      runResult,
      explanation: engineResult.explanation,
      decision,
      toolCalls
    });
    reportAttemptFinished(session, task, iteration, engineResult.command, decision.passed, decision.reason);
    return attempt.passed
      ? { kind: "passed", attempt: { ...attempt, passed: true } }
      : { kind: "retry", attempt: { ...attempt, passed: false } };
  }
  catch (error) {
    throwIfExternalSessionAborted(session);
    const message = error instanceof Error ? error.message : String(error);
    reportWorkerState(session, task, "stopped");
    const attempt = createUnsafeAttempt({
      task,
      iteration,
      command: engineResult.command,
      explanation: engineResult.explanation,
      reason: message,
      toolCalls
    });
    reportAttemptFinished(session, task, iteration, engineResult.command, false, message);
    return { kind: "stopped", attempt, reason: message, explanation: engineResult.explanation };
  }
  finally {
    workerState.phase = "idle";
    workerState.command = "";
  }
}

function createZeroScore(): JudgeScore {
  return {
    value: 0,
    breakdown: {
      correctness: 0,
      stdoutQuality: 0,
      stderrQuality: 0,
      expectedOutput: 0
    }
  };
}

export function createAttemptId(task: WorkerTask, iteration: number): string {
  return `${task.workerId}-attempt-${iteration + 1}`;
}

export function buildJudgeInput(command: string, runResult: RunResult, problem: ProblemSpec): JudgeInput {
  return {
    command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    expectedOutput: problem.expectedOutput
  };
}

export function createUnsafeAttempt({ task, iteration, command, explanation, reason, toolCalls = [] }: AttemptInput): FailedAttempt {
  return {
    attemptId: createAttemptId(task, iteration),
    workerId: task.workerId,
    command,
    passed: false,
    failureReason: reason,
    explanation,
    score: createZeroScore(),
    toolCalls
  };
}

export function createAbortedAttempt({ task, iteration, command, runResult, explanation, reason, toolCalls = [] }: AttemptInput & { runResult: RunResult }): FailedAttempt {
  return {
    attemptId: createAttemptId(task, iteration),
    workerId: task.workerId,
    command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    aborted: runResult.aborted ?? false,
    passed: false,
    explanation,
    failureReason: reason,
    durationMs: runResult.durationMs,
    runnerFailure: runResult.failure ?? null,
    runnerCleanup: runResult.cleanup ?? null,
    score: createZeroScore(),
    toolCalls
  };
}

export function createJudgedAttempt({ task, iteration, command, runResult, explanation, decision, toolCalls = [] }: Omit<AttemptInput, "reason"> & { runResult: RunResult; decision: JudgeDecision }): SolveAttempt {
  return {
    attemptId: createAttemptId(task, iteration),
    workerId: task.workerId,
    command,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
    timedOut: runResult.timedOut,
    aborted: runResult.aborted ?? false,
    passed: decision.passed,
    explanation,
    failureReason: decision.reason,
    durationMs: runResult.durationMs,
    score: decision.score,
    runnerFailure: runResult.failure ?? null,
    runnerCleanup: runResult.cleanup ?? null,
    toolCalls
  };
}

export function createGenerationFailedAttempt({ task, iteration, reason, toolCalls = [] }: Omit<AttemptInput, "command">): FailedAttempt {
  return {
    attemptId: createAttemptId(task, iteration),
    workerId: task.workerId,
    command: "",
    stdout: "",
    stderr: "",
    exitCode: null,
    timedOut: false,
    aborted: false,
    passed: false,
    explanation: "",
    failureReason: reason,
    durationMs: 0,
    runnerFailure: null,
    runnerCleanup: null,
    score: createZeroScore(),
    state: "idle",
    stopReason: "",
    toolCalls
  };
}

export function createWorkerCandidate({ task, attempts, finalAttempt, finalReason, lastExplanation, engineName }: { task: WorkerTask; attempts: SolveAttempt[]; finalAttempt?: SolveAttempt; finalReason: string | undefined; lastExplanation: string; engineName: string }): WorkerCandidate {
  return {
    candidateId: task.workerId,
    workerId: task.workerId,
    strategy: task.strategy,
    command: finalAttempt?.command ?? "",
    output: finalAttempt?.stdout?.trimEnd() ?? "",
    explanation: finalAttempt?.explanation ?? lastExplanation ?? "No explanation provided.",
    attempts,
    finalCheck: {
      passed: finalAttempt?.passed ?? false,
      iterations: attempts.length,
      engine: engineName,
      reason: finalReason,
      score: finalAttempt?.score
    }
  };
}

export function createWorkerSummary({ task, attempts, finalCheck, finalState }: { task: WorkerTask; attempts: SolveAttempt[]; finalCheck: CandidateFinalCheck; finalState: WorkerPhase }): WorkerSummary {
  return {
    workerId: task.workerId,
    strategy: task.strategy,
    strategyProfile: task.strategyProfile,
    attemptCount: attempts.length,
    passed: finalCheck.passed,
    state: finalState,
    reason: finalCheck.reason
  };
}

export function getWorkerStopReason(session: SolveSession, control: ExecutionControl): string {
  if (control.stopRequested) {
    if (control.stopReason) {
      return control.stopReason;
    }
    if (control.passingCandidateId != null) {
      return `Stopped because ${control.passingCandidateId} already produced a passing candidate.`;
    }
    return "Execution was stopped.";
  }
  if (session.deadlineAtMs != null && Date.now() >= session.deadlineAtMs) {
    control.stopReason = "Stopped because the overall time budget was exhausted.";
    return control.stopReason;
  }
  return "";
}

export function getRemainingBudgetMs(session: SolveSession): number | undefined {
  if (session.deadlineAtMs == null) {
    return undefined;
  }
  return Math.max(0, session.deadlineAtMs - Date.now());
}
