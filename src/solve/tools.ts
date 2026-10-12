import type {
  Engine,
  EngineResult,
  SolveContext,
  ToolCallSummary,
  ToolDefinition,
  ToolExecutionCall,
  ToolExecutionResult,
  ToolRegistry,
  ToolRegistration,
  ToolCallingEngine,
  WorkerGeneration
} from "../types.js";
import { awaitWithSignal } from "../shared.js";
import { z } from "zod";

interface GeneratedWorkerCommand {
  engineResult: EngineResult;
  toolCalls: ToolCallSummary[];
}
interface GenerateWorkerCommandInput {
  engine: Engine;
  context: SolveContext;
  toolRegistry?: ToolRegistry;
  signal?: AbortSignal;
}
interface RegisteredTool {
  definition(): ToolDefinition;
  execute(argumentsValue: unknown): Promise<ToolExecutionResult>;
}
type ToolResultSummary = Pick<ToolCallSummary, "resultCount" | "recordIds">;
// Keep typed output closures private while preserving the public execute result shape.
const registeredSummaries = new WeakMap<ToolExecutionResult, () => ToolResultSummary | undefined>();
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class WorkerToolLoopError extends Error {
  readonly toolCalls: ToolCallSummary[];
  constructor(message: string, toolCalls: ToolCallSummary[] = []) {
    super(message);
    this.name = "WorkerToolLoopError";
    this.toolCalls = toolCalls;
  }
}

function summarizeLegacyToolResult(toolResult: ToolExecutionResult): ToolResultSummary {
  const records: unknown[] = toolResult.ok && isRecord(toolResult.value) && Array.isArray(toolResult.value.records)
    ? toolResult.value.records
    : [];
  return {
    resultCount: records.length,
    recordIds: records.flatMap(record => isRecord(record) && typeof record.id === "string" && record.id ? [record.id] : [])
  };
}

async function executeWorkerTool(registry: ToolRegistry, call: ToolExecutionCall, signal?: AbortSignal): Promise<{ result: ToolExecutionResult; summary: ToolCallSummary }> {
  // Invoke injected overrides with their receiver before reading summary metadata.
  const result = await awaitWithSignal(() => registry.execute(call), signal);
  let metadata: ToolResultSummary | undefined;
  try {
    const summary = registeredSummaries.get(result)?.();
    metadata = summary ? { resultCount: summary.resultCount, recordIds: summary.recordIds } : undefined;
  } catch {
    // Summary failures must not change a successful Tool result or expose exceptions.
  }
  const { resultCount, recordIds } = metadata ?? summarizeLegacyToolResult(result);
  return {
    result,
    summary: {
      name: call.name,
      arguments: result.validatedArguments ?? {},
      status: result.ok ? "completed" : "error",
      resultCount,
      recordIds
    }
  };
}

async function generateCommand({ engine, context, signal }: Omit<GenerateWorkerCommandInput, "toolRegistry">): Promise<GeneratedWorkerCommand> {
  signal?.throwIfAborted();
  const engineResult = await (signal
    ? engine.generateCommand(context, { signal })
    : engine.generateCommand(context));
  signal?.throwIfAborted();
  return { engineResult, toolCalls: [] };
}

async function generateToolCommand({ engine, context, toolRegistry, signal }: {
  engine: Pick<ToolCallingEngine, "generateTurn">;
  context: SolveContext;
  toolRegistry: ToolRegistry;
  signal?: AbortSignal;
}): Promise<GeneratedWorkerCommand> {
  signal?.throwIfAborted();
  const tools = toolRegistry.definitions();
  const firstTurn = await engine.generateTurn({ context, tools, ...(signal ? { signal } : {}) });
  signal?.throwIfAborted();
  if (firstTurn?.type === "command") {
    return { engineResult: firstTurn, toolCalls: [] };
  }
  if (firstTurn?.type !== "tool_calls" ||
    !Array.isArray(firstTurn.calls) ||
    firstTurn.calls.length !== 1) {
    throw new WorkerToolLoopError("Worker Engine must return exactly one Tool call.");
  }
  const call = firstTurn.calls[0];
  // Cancel this worker's wait; shared Knowledge embeddings remain session-owned.
  const { result: toolResult, summary } = await executeWorkerTool(toolRegistry, {
    name: call.name,
    arguments: call.arguments
  }, signal);
  signal?.throwIfAborted();
  const publicToolResult = toolResult.ok
    ? { ok: true as const, value: toolResult.value }
    : { ok: false as const, error: toolResult.error };
  const finalTurn = await engine.generateTurn({
    context,
    tools,
    ...(signal ? { signal } : {}),
    continuation: firstTurn.continuation,
    toolResults: [{ callId: call.id, result: publicToolResult }]
  });
  signal?.throwIfAborted();
  if (finalTurn?.type !== "command") {
    throw new WorkerToolLoopError("Worker Tool call limit exceeded.", [summary]);
  }
  return {
    engineResult: finalTurn,
    toolCalls: [summary]
  };
}

/** Internal sessions have selected and validated their generation path once. */
export function generateSessionWorkerCommand(session: WorkerGeneration, context: SolveContext, signal?: AbortSignal): Promise<GeneratedWorkerCommand> {
  switch (session.generation) {
    case "command": return generateCommand({ engine: session.engine, context, signal });
    case "tools": return generateToolCommand({ engine: session.engine, context, toolRegistry: session.toolRegistry, signal });
  }
}

/** Compatibility boundary for callers injecting a registry and legacy Tool Engine. */
export async function generateWorkerCommand({ engine, context, toolRegistry, signal }: GenerateWorkerCommandInput): Promise<GeneratedWorkerCommand> {
  signal?.throwIfAborted();
  if (!toolRegistry) return generateCommand({ engine, context, signal });
  if (!supportsToolTurns(engine)) throw new TypeError("Worker Engine does not support Tool turns.");
  return generateToolCommand({ engine, context, toolRegistry, signal });
}

function supportsToolTurns(engine: Engine): engine is Engine & Pick<ToolCallingEngine, "generateTurn"> {
  return typeof engine.generateTurn === "function";
}

function supportsZodSchema(inputSchema: unknown): inputSchema is z.ZodType {
  if (!(inputSchema instanceof z.ZodType)) {
    return false;
  }
  try {
    z.toJSONSchema(inputSchema);
    return true;
  }
  catch {
    return false;
  }
}

function invalidArgumentsResult(name: string): ToolExecutionResult {
  return {
    ok: false,
    error: {
      code: "invalid_arguments",
      message: `Invalid arguments for Tool ${name}.`
    },
    validatedArguments: {}
  };
}

function validateTool<Input extends Record<string, unknown>, Output>(tool: ToolRegistration<Input, Output>) {
  if (typeof tool?.name !== "string" || tool.name.trim().length === 0) {
    throw new TypeError("Tool name must be a non-empty string.");
  }
  if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
    throw new TypeError("Tool description must be a non-empty string.");
  }
  if (!supportsZodSchema(tool.inputSchema)) {
    throw new TypeError("Tool inputSchema must be a JSON Schema-compatible Zod schema.");
  }
  if (typeof tool.execute !== "function") {
    throw new TypeError("Tool execute must be a function.");
  }
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();
  return {
    register<Input extends Record<string, unknown>, Output>(tool: ToolRegistration<Input, Output>): void {
      validateTool(tool);
      if (tools.has(tool.name)) {
        throw new Error(`Tool already registered: ${tool.name}`);
      }
      // Capture schema, executor, output and summarizer together before type erasure.
      const snapshot = Object.freeze({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: tool.execute,
        summarize: tool.summarize
      });
      const { name, description, inputSchema } = snapshot;
      tools.set(name, {
        definition(): ToolDefinition {
          const { $schema: _schema, ...parameters } = z.toJSONSchema(inputSchema);
          return { name, description, parameters };
        },
        async execute(argumentsValue: unknown): Promise<ToolExecutionResult> {
          let parsed;
          try {
            parsed = await inputSchema.safeParseAsync(argumentsValue);
          } catch {
            return invalidArgumentsResult(name);
          }
          if (!parsed.success) return invalidArgumentsResult(name);
          try {
            const value = await snapshot.execute(parsed.data);
            const result: ToolExecutionResult = { ok: true, value, validatedArguments: parsed.data };
            if (snapshot.summarize) {
              registeredSummaries.set(result, () => result.ok && Object.is(result.value, value)
                ? snapshot.summarize?.(value)
                : undefined);
            }
            return result;
          } catch {
            return {
              ok: false,
              error: { code: "tool_execution_failed", message: `Tool ${name} failed.` },
              validatedArguments: parsed.data
            };
          }
        }
      });
    },
    definitions(): ToolDefinition[] {
      return Array.from(tools.values(), tool => tool.definition());
    },
    async execute({ name, arguments: argumentsValue }): Promise<ToolExecutionResult> {
      const tool = tools.get(name);
      if (!tool) {
        return {
          ok: false,
          error: { code: "unknown_tool", message: `Unknown Tool: ${name}` },
          validatedArguments: {}
        };
      }
      return tool.execute(argumentsValue);
    }
  };
}
