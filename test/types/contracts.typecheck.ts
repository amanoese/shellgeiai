import type { Engine, EngineTurn, InitializingSolveSession, SolveAttempt, SolveSession, ToolExecutionResult, ToolRegistration, WorkerAttemptOutcome } from "../../src/types.js";
import { z } from "zod";

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
