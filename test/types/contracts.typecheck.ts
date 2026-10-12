import type { Engine, EngineTurn, ExecutionControl, ExecutionStopState, InitializingSolveSession, RunResult, Runner, SolveAttempt, SolveSession, ToolExecutionResult, ToolRegistration, WorkerAttemptOutcome } from "../../src/types.js";
import { z } from "zod";
import { createToolRegistry } from "../../src/solve/tools.js";
import { runSolveOrchestrator } from "../../src/solve/orchestrator.js";
import { createSolveSession } from "../../src/solve/solve.js";
import { createAbortedAttempt, createJudgedAttempt, runWorkerAttempt, executeWorkerTask } from "../../src/solve/worker.js";


const success: ToolExecutionResult<number> = { ok: true, value: 3, validatedArguments: {} };
const failure: ToolExecutionResult = { ok: false, error: { code: "invalid_arguments", message: "Invalid input" }, validatedArguments: {} };
// @ts-expect-error Successful tool execution must have a value.
const noValue: ToolExecutionResult = { ok: true, validatedArguments: {} };
const command: EngineTurn = { type: "command", command: "printf x" };
// @ts-expect-error A command turn must have a command.
const noCommand: EngineTurn = { type: "command" };
const tools: EngineTurn = { type: "tool_calls", calls: [], continuation: {} };
const passed: WorkerAttemptOutcome<SolveAttempt> = { kind: "passed", attempt: { command: "printf x", passed: true } };
const retry: WorkerAttemptOutcome<SolveAttempt> = { kind: "retry", attempt: { command: "printf x", passed: false } };
const stopped: WorkerAttemptOutcome<SolveAttempt> = { kind: "stopped", reason: "Stopped", explanation: undefined, attempt: null };
const sparseStopped: WorkerAttemptOutcome<SolveAttempt> = { kind: "stopped", reason: "Unsafe", explanation: undefined, attempt: { command: "rm x", passed: false } };
// @ts-expect-error A stopped outcome must explicitly say whether an attempt exists.
const noAttempt: WorkerAttemptOutcome<SolveAttempt> = { kind: "stopped", reason: "Stopped", explanation: undefined };
// @ts-expect-error A passing outcome cannot carry a failed attempt.
const wrongPassed: WorkerAttemptOutcome<SolveAttempt> = { kind: "passed", attempt: { command: "printf x", passed: false } };
const plainEngine: Engine = { name: "plain", generateCommand: async () => ({ command: "printf x" }) };
const toolEngine: Engine = { ...plainEngine, capabilities: { toolCalling: true }, generateTurn: async () => command };
// @ts-expect-error Engines declaring tool calling must implement generateTurn.
const missingTurn: Engine = { name: "broken", capabilities: { toolCalling: true }, generateCommand: async () => ({ command: "printf x" }) };
const registration: ToolRegistration<{ query: string }> = { name: "search", description: "Search", inputSchema: z.object({ query: z.string() }), execute: input => input.query };
// @ts-expect-error Schema output must match the execute input.
const badSchema: ToolRegistration<{ query: string }> = { ...registration, inputSchema: z.object({ query: z.number() }) };
function exhaustive(outcome: WorkerAttemptOutcome<SolveAttempt>): string {
  switch (outcome.kind) {
    case "passed": { const value: true = outcome.attempt.passed; return String(value); }
    case "retry": { const value: false = outcome.attempt.passed; return String(value); }
    case "stopped": return outcome.reason;
    default: { const unreachable: never = outcome; return unreachable; }
  }
}
void [success, failure, noValue, command, noCommand, tools, passed, retry, stopped, sparseStopped, noAttempt, wrongPassed, plainEngine, toolEngine, missingTurn, registration, badSchema, exhaustive];

// A session may enter orchestration only once planning has completed.
declare const initializing: InitializingSolveSession;
// @ts-expect-error Initializing sessions have no required execution plan.
const unplanned: SolveSession = initializing;
declare const ready: SolveSession;
const plannedTasks = ready.plan.workerTasks;
void [unplanned, plannedTasks];

function exhaustiveEngineTurn(turn: EngineTurn): string {
  switch (turn.type) {
    case "command": return turn.command;
    case "tool_calls": return turn.calls.map(call => call.name).join(",");
    default: { const unreachable: never = turn; return unreachable; }
  }
}
function exhaustiveToolResult(result: ToolExecutionResult<number>): string {
  switch (result.ok) {
    case true: { const value: number = result.value; return String(value); }
    case false: return result.error.code;
    default: { const unreachable: never = result; return unreachable; }
  }
}
const registry = createToolRegistry();
registry.register({
  name: "typed-summary", description: "Infer execution output before summarizing",
  inputSchema: z.object({ query: z.string() }),
  execute: async input => ({ ids: [input.query] }),
  summarize(value) {
    const ids: string[] = value.ids;
    // @ts-expect-error Summarizers cannot access fields absent from execution output.
    value.records;
    return { resultCount: ids.length, recordIds: ids };
  }
});
async function unknownRegistryOutput() {
  const result = await registry.execute({ name: "typed-summary", arguments: { query: "awk" } });
  if (result.ok) {
    // @ts-expect-error Heterogeneous registry execution deliberately returns unknown output.
    result.value.ids;
  }
}
void unknownRegistryOutput;
registry.register({ name: "inferred", description: "Inferred schema output", inputSchema: z.object({ count: z.number() }), execute(input) { const count: number = input.count; return count; } });
registry.register({ name: "wrong-input", description: "Mismatched schema output", inputSchema: z.object({ count: z.number() }),
  // @ts-expect-error Executor cannot treat the schema's numeric output as text.
  execute: (input: { count: string }) => input.count
});
async function attemptReturnContract(input: Parameters<typeof runWorkerAttempt>[0]) {
  const outcome: WorkerAttemptOutcome<SolveAttempt> = await runWorkerAttempt(input);
  // @ts-expect-error Outcome wrappers do not duplicate command from the attempt.
  outcome.command;
  return outcome;
}
void [exhaustiveEngineTurn, exhaustiveToolResult, registry, attemptReturnContract];

async function readySessionContracts(options: Parameters<typeof createSolveSession>[0], task: Parameters<typeof executeWorkerTask>[1], control: Parameters<typeof executeWorkerTask>[2], state: Parameters<typeof executeWorkerTask>[3]) {
  const session: SolveSession = await createSolveSession(options);
  await runSolveOrchestrator(session);
  await executeWorkerTask(session, task, control, state);
  // @ts-expect-error Orchestration requires a completed plan.
  await runSolveOrchestrator(initializing);
  // @ts-expect-error Workers require a completed plan.
  await executeWorkerTask(initializing, task, control, state);
  // @ts-expect-error Injected planner metadata stays unknown until a consumer validates it.
  const prompt: string = session.plan.planner.prompt;
  return prompt;
}
void readySessionContracts;

// Public Runners may omit metadata; executed attempt factories require normalization.
const minimalRunResult: RunResult = { stdout: "ok", stderr: "", exitCode: 0, timedOut: false };
const minimalRunner: Runner = { run: async () => minimalRunResult };
type ExecutedRunResult = Parameters<typeof createJudgedAttempt>[0]["runResult"];
const normalizedRunResult: ExecutedRunResult = { ...minimalRunResult, aborted: false, failure: null, cleanup: null };
declare const withoutAborted: Omit<ExecutedRunResult, "aborted">;
declare const withoutFailure: Omit<ExecutedRunResult, "failure">;
declare const withoutCleanup: Omit<ExecutedRunResult, "cleanup">;
// @ts-expect-error Executed results must carry a definite aborted flag.
const missingAborted: ExecutedRunResult = withoutAborted;
// @ts-expect-error Executed results must carry failure metadata or explicit null.
const missingFailure: ExecutedRunResult = withoutFailure;
// @ts-expect-error Executed results must carry cleanup metadata or explicit null.
const missingCleanup: ExecutedRunResult = withoutCleanup;
// @ts-expect-error Aborted attempts require the same normalized Runner result.
const unnormalizedAborted: Parameters<typeof createAbortedAttempt>[0]["runResult"] = minimalRunResult;
void [minimalRunner, normalizedRunResult, missingAborted, missingFailure, missingCleanup, unnormalizedAborted];

// Ready generation contracts bind mode, Engine capability and registry together.
type ReadyCommon = Omit<SolveSession, "generation" | "engine" | "knowledgeMode" | "toolRegistry">;
declare const readyCommon: ReadyCommon;
const commandSession: SolveSession = { ...readyCommon, generation: "command", engine: toolEngine, knowledgeMode: "planner" };
const toolSession: SolveSession = { ...readyCommon, generation: "tools", engine: toolEngine, knowledgeMode: "worker", toolRegistry: registry };
// @ts-expect-error Tool sessions require a Tool Calling Engine.
const wrongToolEngine: SolveSession = { ...readyCommon, generation: "tools", engine: plainEngine, knowledgeMode: "worker", toolRegistry: registry };
// @ts-expect-error Tool sessions require a registry.
const noToolRegistry: SolveSession = { ...readyCommon, generation: "tools", engine: toolEngine, knowledgeMode: "all" };
// @ts-expect-error Command generation cannot be paired with worker knowledge.
const wrongCommandMode: SolveSession = { ...readyCommon, generation: "command", engine: plainEngine, knowledgeMode: "worker" };
// @ts-expect-error Command sessions cannot carry a Tool registry.
const wrongCommandRegistry: SolveSession = { ...readyCommon, generation: "command", engine: plainEngine, knowledgeMode: "off", toolRegistry: registry };
declare const readyWithoutPlan: Omit<Extract<SolveSession, { generation: "command" }>, "plan">;
// @ts-expect-error Even a normalized generation needs a plan before becoming ready.
const missingReadyPlan: SolveSession = readyWithoutPlan;
function exhaustiveGeneration(session: SolveSession): string {
  switch (session.generation) {
    case "command": { const mode: "off" | "planner" = session.knowledgeMode; return mode; }
    case "tools": { session.engine.generateTurn({ context: { problem: "x", attempts: [], workdir: "/tmp" }, tools: session.toolRegistry.definitions() }); return session.knowledgeMode; }
    default: { const unreachable: never = session; return unreachable; }
  }
}
void [commandSession, toolSession, wrongToolEngine, noToolRegistry, wrongCommandMode, wrongCommandRegistry, missingReadyPlan, exhaustiveGeneration];

const runningStopState: ExecutionStopState = { kind: "running", passingCandidateId: null };
const graceStopState: ExecutionStopState = { kind: "grace", reason: "first pass", passingCandidateId: "worker-1" };
const observedStopState: ExecutionStopState = { kind: "deadline-observed", reason: "deadline", passingCandidateId: null };
const stoppedState: ExecutionStopState = { kind: "stopped", reason: "", passingCandidateId: "worker-1" };
// @ts-expect-error A stopped state must carry a reason, including when it is empty.
const stopWithoutReason: ExecutionStopState = { kind: "stopped", passingCandidateId: null };
// @ts-expect-error A grace state must carry its pending reason.
const graceWithoutReason: ExecutionStopState = { kind: "grace", passingCandidateId: null };
// @ts-expect-error An observed deadline must retain its reason.
const deadlineWithoutReason: ExecutionStopState = { kind: "deadline-observed", passingCandidateId: null };
declare const executionControl: ExecutionControl;
// @ts-expect-error Stop projections cannot be independently changed by workers.
executionControl.stopRequested = true;
// @ts-expect-error Stop projections cannot be independently changed by workers.
executionControl.stopReason = "worker stop";
// @ts-expect-error Passing candidates are recorded through the control method.
executionControl.passingCandidateId = "worker-1";
executionControl.recordPassingCandidate("worker-1");
function exhaustiveExecutionStop(state: ExecutionStopState): string {
  switch (state.kind) {
    case "running": return state.passingCandidateId ?? "";
    case "grace": return state.reason;
    case "deadline-observed": return state.reason;
    case "stopped": return state.reason;
    default: { const unreachable: never = state; return unreachable; }
  }
}
void [runningStopState, graceStopState, observedStopState, stoppedState, stopWithoutReason, graceWithoutReason, deadlineWithoutReason, exhaustiveExecutionStop];
