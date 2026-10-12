import { awaitWithSignal } from "../../shared.js";

export class WorkerToolLoopError extends Error {
  constructor(message, toolCalls = []) {
    super(message);
    this.name = "WorkerToolLoopError";
    this.toolCalls = toolCalls;
  }
}

function createToolCallSummary(call, toolResult) {
  const records = toolResult.ok && Array.isArray(toolResult.value?.records)
    ? toolResult.value.records
    : [];

  return {
    name: call.name,
    arguments: toolResult.validatedArguments ?? {},
    status: toolResult.ok ? "completed" : "error",
    resultCount: records.length,
    recordIds: records.map((record) => record?.id).filter(Boolean)
  };
}

export async function generateWorkerCommand({ engine, context, toolRegistry, signal }) {
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

  const tools = toolRegistry.definitions();
  const firstTurn = await engine.generateTurn({ context, tools, ...(signal ? { signal } : {}) });
  signal?.throwIfAborted();
  if (firstTurn?.type === "command") {
    return { engineResult: firstTurn, toolCalls: [] };
  }
  if (
    firstTurn?.type !== "tool_calls" ||
    !Array.isArray(firstTurn.calls) ||
    firstTurn.calls.length !== 1
  ) {
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
