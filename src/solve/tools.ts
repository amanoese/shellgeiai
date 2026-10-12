import type {
  Engine,
  EngineResult,
  SolveContext,
  ToolCallSummary,
  EngineToolCall,
  ToolDefinition,
  ToolExecutionResult,
  ToolRegistry,
  ToolRegistration
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

function createToolCallSummary(call: EngineToolCall, toolResult: ToolExecutionResult): ToolCallSummary {
  const records: unknown[] = toolResult.ok && isRecord(toolResult.value) && Array.isArray(toolResult.value.records)
    ? toolResult.value.records
    : [];
  return {
    name: call.name,
    arguments: toolResult.validatedArguments ?? {},
    status: toolResult.ok ? "completed" : "error",
    resultCount: records.length,
    recordIds: records.flatMap(record => isRecord(record) && typeof record.id === "string" && record.id ? [record.id] : [])
  };
}

export async function generateWorkerCommand({ engine, context, toolRegistry, signal }: GenerateWorkerCommandInput): Promise<GeneratedWorkerCommand> {
  signal?.throwIfAborted();
  if (!toolRegistry) {
    const engineResult = await (signal
      ? engine.generateCommand(context, { signal })
      : engine.generateCommand(context));
    signal?.throwIfAborted();
    return {
      engineResult,
      toolCalls: []
    };
  }
  if (!engine.generateTurn) throw new TypeError("Worker Engine does not support Tool turns.");
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
  const toolResult = await awaitWithSignal(() => toolRegistry.execute({
    name: call.name,
    arguments: call.arguments
  }), signal);
  const summary = createToolCallSummary(call, toolResult);
  signal?.throwIfAborted();
  const { validatedArguments: _validatedArguments, ...publicToolResult } = toolResult;
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

function validateTool<T extends Record<string, unknown>>(tool: ToolRegistration<T>) {
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
    register<T extends Record<string, unknown>>(tool: ToolRegistration<T>): void {
      validateTool(tool);
      if (tools.has(tool.name)) {
        throw new Error(`Tool already registered: ${tool.name}`);
      }
      // Capture the schema and its matching executor together before erasing input types.
      const snapshot = Object.freeze({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: tool.execute
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
            return { ok: true, value, validatedArguments: parsed.data };
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
