import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createToolRegistry } from "../src/tools/toolRegistry.js";
import {
  WorkerToolLoopError,
  generateWorkerCommand
} from "../src/solve/worker/toolLoop.js";

function createRegistry(execute = async () => ({ records: [] })) {
  const registry = createToolRegistry();
  registry.register({
    name: "search_knowledge",
    description: "Search command knowledge.",
    inputSchema: z.object({ query: z.string().trim().min(1) }).strict(),
    execute
  });
  return registry;
}

describe("generateWorkerCommand", () => {
  it("uses the legacy command path when no Tool registry is configured", async () => {
    const engineResult = { command: "printf ok", explanation: "Print ok." };
    const engine = {
      generateCommand: vi.fn(async () => engineResult),
      generateTurn: vi.fn()
    };
    const context = { problem: "print ok", attempts: [] };

    await expect(generateWorkerCommand({ engine, context })).resolves.toEqual({
      engineResult,
      toolCalls: []
    });
    expect(engine.generateCommand).toHaveBeenCalledOnce();
    expect(engine.generateCommand).toHaveBeenCalledWith(context);
    expect(engine.generateTurn).not.toHaveBeenCalled();
  });

  it("returns an initial command without executing a Tool", async () => {
    const engineResult = { type: "command", command: "printf ok", explanation: "Print ok." };
    const execute = vi.fn(async () => ({ records: [] }));
    const toolRegistry = createRegistry(execute);
    const engine = { generateTurn: vi.fn(async () => engineResult) };
    const context = { problem: "print ok", attempts: [] };

    await expect(generateWorkerCommand({ engine, context, toolRegistry })).resolves.toEqual({
      engineResult,
      toolCalls: []
    });
    expect(engine.generateTurn).toHaveBeenCalledWith({
      context,
      tools: toolRegistry.definitions()
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["an invalid turn type", { type: "message" }],
    ["zero Tool calls", { type: "tool_calls", calls: [], continuation: { responseId: "r1" } }],
    [
      "a non-array Tool call collection",
      {
        type: "tool_calls",
        calls: {
          0: { id: "c1", name: "search_knowledge", arguments: { query: "awk" } },
          length: 1
        },
        continuation: { responseId: "r1" }
      }
    ],
    [
      "multiple Tool calls",
      {
        type: "tool_calls",
        calls: [
          { id: "c1", name: "search_knowledge", arguments: { query: "awk" } },
          { id: "c2", name: "search_knowledge", arguments: { query: "sed" } }
        ],
        continuation: { responseId: "r1" }
      }
    ]
  ])("rejects %s before Tool execution", async (_label, firstTurn) => {
    const execute = vi.fn(async () => ({ records: [] }));
    const engine = { generateTurn: vi.fn(async () => firstTurn) };

    await expect(
      generateWorkerCommand({
        engine,
        context: { problem: "print ok", attempts: [] },
        toolRegistry: createRegistry(execute)
      })
    ).rejects.toMatchObject({
      name: "WorkerToolLoopError",
      message: "Worker Engine must return exactly one Tool call.",
      toolCalls: []
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("continues after one Tool call with a public result and a bounded summary", async () => {
    const rawRecord = {
      id: "man:awk:-F",
      command: "awk",
      text: "retrieved text must not be persisted"
    };
    const execute = vi.fn(async () => ({ records: [rawRecord, { text: "without id" }] }));
    const toolRegistry = createRegistry(execute);
    const firstTurn = {
      type: "tool_calls",
      calls: [
        {
          id: "call-1",
          name: "search_knowledge",
          arguments: { query: "  awk fields  " }
        }
      ],
      continuation: { responseId: "response-1" }
    };
    const finalTurn = { type: "command", command: "awk '{print $1}'", explanation: "Use awk." };
    const engine = { generateTurn: vi.fn().mockResolvedValueOnce(firstTurn).mockResolvedValueOnce(finalTurn) };
    const context = { problem: "print first field", attempts: [] };

    await expect(generateWorkerCommand({ engine, context, toolRegistry })).resolves.toEqual({
      engineResult: finalTurn,
      toolCalls: [
        {
          name: "search_knowledge",
          arguments: { query: "awk fields" },
          status: "completed",
          resultCount: 2,
          recordIds: ["man:awk:-F"]
        }
      ]
    });
    expect(execute).toHaveBeenCalledWith({ query: "awk fields" });
    expect(engine.generateTurn).toHaveBeenNthCalledWith(2, {
      context,
      tools: toolRegistry.definitions(),
      continuation: firstTurn.continuation,
      toolResults: [
        {
          callId: "call-1",
          result: { ok: true, value: { records: [rawRecord, { text: "without id" }] } }
        }
      ]
    });
    expect(JSON.stringify(engine.generateTurn.mock.calls[1][0].toolResults)).not.toContain(
      "validatedArguments"
    );
  });

  it("continues after an invalid Tool call and consumes its one-call budget", async () => {
    const toolRegistry = createRegistry();
    const firstTurn = {
      type: "tool_calls",
      calls: [
        { id: "call-1", name: "search_knowledge", arguments: { query: "" } }
      ],
      continuation: { responseId: "response-1" }
    };
    const finalTurn = { type: "command", command: "printf ok", explanation: "Print ok." };
    const engine = { generateTurn: vi.fn().mockResolvedValueOnce(firstTurn).mockResolvedValueOnce(finalTurn) };

    await expect(
      generateWorkerCommand({
        engine,
        context: { problem: "print ok", attempts: [] },
        toolRegistry
      })
    ).resolves.toEqual({
      engineResult: finalTurn,
      toolCalls: [
        {
          name: "search_knowledge",
          arguments: {},
          status: "error",
          resultCount: 0,
          recordIds: []
        }
      ]
    });
    expect(engine.generateTurn.mock.calls[1][0].toolResults[0].result).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" }
    });
    expect(engine.generateTurn.mock.calls[1][0].toolResults[0].result).not.toHaveProperty(
      "validatedArguments"
    );
  });

  it("rejects a second Tool turn without executing it and preserves the first summary", async () => {
    const execute = vi.fn(async () => ({ records: [{ id: "man:awk", text: "secret text" }] }));
    const firstTurn = {
      type: "tool_calls",
      calls: [
        { id: "call-1", name: "search_knowledge", arguments: { query: "awk" } }
      ],
      continuation: { responseId: "response-1" }
    };
    const secondTurn = {
      type: "tool_calls",
      calls: [
        { id: "call-2", name: "search_knowledge", arguments: { query: "sed" } }
      ],
      continuation: { responseId: "response-2" }
    };
    const engine = { generateTurn: vi.fn().mockResolvedValueOnce(firstTurn).mockResolvedValueOnce(secondTurn) };

    let caught;
    try {
      await generateWorkerCommand({
        engine,
        context: { problem: "print ok", attempts: [] },
        toolRegistry: createRegistry(execute)
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkerToolLoopError);
    expect(caught).toMatchObject({
      message: "Worker Tool call limit exceeded.",
      toolCalls: [
        {
          name: "search_knowledge",
          arguments: { query: "awk" },
          status: "completed",
          resultCount: 1,
          recordIds: ["man:awk"]
        }
      ]
    });
    expect(JSON.stringify(caught.toolCalls)).not.toContain("secret text");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
