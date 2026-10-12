import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createKnowledgeRetriever } from "../src/knowledge/retriever.js";
import { createSearchKnowledgeTool } from "../src/knowledge/searchKnowledgeTool.js";
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

function createSearchingEngine() {
  return {
    generateTurn: vi.fn(async ({ toolResults }) => toolResults
      ? { type: "command", command: "printf ok" }
      : {
        type: "tool_calls",
        calls: [{ id: "c1", name: "search_knowledge", arguments: { query: "awk" } }],
        continuation: {}
      })
  };
}

describe("generateWorkerCommand", () => {
  it.each(["resolve", "reject"])("cancels a pending Tool wait before its late %s without resuming the model", async settlement => {
    const controller = new AbortController();
    const reason = new Error("worker cancelled during Tool wait");
    const pending = Promise.withResolvers();
    const toolRegistry = { definitions: () => [], execute: vi.fn(() => pending.promise) };
    const engine = createSearchingEngine();
    let outcome;
    const worker = generateWorkerCommand({ engine, context: {}, toolRegistry, signal: controller.signal })
      .then(value => { outcome = { value }; }, error => { outcome = { error }; });

    try {
      await vi.waitFor(() => expect(toolRegistry.execute).toHaveBeenCalledOnce());
      controller.abort(reason);
      await vi.waitFor(() => expect(outcome?.error).toBe(reason), { timeout: 100 });
      expect(engine.generateTurn).toHaveBeenCalledOnce();
    } finally {
      if (settlement === "reject") pending.reject(new Error("late Tool failure"));
      else pending.resolve({ ok: true, value: { records: [] } });
      await worker;
      // Let a late rejection reach the event loop so Vitest also detects unhandled rejections.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(outcome.error).toBe(reason);
    expect(engine.generateTurn).toHaveBeenCalledOnce();
  });

  it("cancels only one worker wait while sharing and caching the session query embedding", async () => {
    const sessionController = new AbortController();
    const cancelledController = new AbortController();
    const activeController = new AbortController();
    const reason = new Error("stop one worker");
    const embedding = Promise.withResolvers();
    const embedder = { embed: vi.fn(() => embedding.promise) };
    const records = [{ id: "man:awk", command: "awk", option: "-F", text: "Split fields.", source: "test" }];
    const store = { search: vi.fn(() => records) };
    const retriever = createKnowledgeRetriever({ store, generationId: 7, embedder, signal: sessionController.signal });
    const toolRegistry = createToolRegistry();
    toolRegistry.register(createSearchKnowledgeTool({ retriever }));
    const cancelledEngine = createSearchingEngine();
    const activeEngine = createSearchingEngine();
    let cancelledOutcome;
    let activeOutcome;
    const cancelledWorker = generateWorkerCommand({ engine: cancelledEngine, context: {}, toolRegistry, signal: cancelledController.signal })
      .then(value => { cancelledOutcome = { value }; }, error => { cancelledOutcome = { error }; });
    const activeWorker = generateWorkerCommand({ engine: activeEngine, context: {}, toolRegistry, signal: activeController.signal })
      .then(value => { activeOutcome = { value }; }, error => { activeOutcome = { error }; });

    try {
      await vi.waitFor(() => expect(embedder.embed).toHaveBeenCalledOnce());
      cancelledController.abort(reason);
      await vi.waitFor(() => expect(cancelledOutcome?.error).toBe(reason), { timeout: 100 });
      expect(sessionController.signal.aborted).toBe(false);
      expect(embedder.embed.mock.calls[0][1].signal).toBe(sessionController.signal);
      expect(activeOutcome).toBeUndefined();
      expect(cancelledEngine.generateTurn).toHaveBeenCalledOnce();
      expect(activeEngine.generateTurn).toHaveBeenCalledOnce();

      embedding.resolve([1, 0]);
      await activeWorker;
      expect(activeOutcome.error).toBeUndefined();
      expect(activeOutcome.value.engineResult.command).toBe("printf ok");
      expect(activeEngine.generateTurn.mock.calls[1][0].toolResults[0].result.value.records).toEqual(records);

      const cached = await generateWorkerCommand({ engine: createSearchingEngine(), context: {}, toolRegistry, signal: activeController.signal });
      expect(cached.toolCalls[0].recordIds).toEqual(["man:awk"]);
      expect(embedder.embed).toHaveBeenCalledOnce();
      expect(sessionController.signal.aborted).toBe(false);
    } finally {
      embedding.resolve([1, 0]);
      await Promise.all([cancelledWorker, activeWorker]);
    }
  });

  it("passes cancellation to command generation", async () => {
    const signal = new AbortController().signal;
    const context = { problem: "print ok", attempts: [] };
    const engine = { generateCommand: vi.fn(async () => ({ command: "printf ok" })) };
    await generateWorkerCommand({ engine, context, signal });
    expect(engine.generateCommand).toHaveBeenCalledWith(context, { signal });
  });

  it("passes the same cancellation signal to both Tool Calling turns", async () => {
    const signal = new AbortController().signal;
    const engine = { generateTurn: vi.fn()
      .mockResolvedValueOnce({ type: "tool_calls", calls: [{ id: "c1", name: "search_knowledge", arguments: { query: "awk" } }], continuation: {} })
      .mockResolvedValueOnce({ type: "command", command: "printf ok" }) };
    await generateWorkerCommand({ engine, context: { problem: "print ok", attempts: [] }, toolRegistry: createRegistry(), signal });
    expect(engine.generateTurn.mock.calls.map(([input]) => input.signal)).toEqual([signal, signal]);
  });

  it.each(["before-generation", "before-tool", "before-final"])("stops on cancellation %s", async stage => {
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error("worker cancelled"));
    if (stage === "before-generation") cancel();
    const execute = vi.fn(async () => { if (stage === "before-final") cancel(); return { records: [] }; });
    const engine = { generateTurn: vi.fn(async () => {
      if (stage === "before-tool") cancel();
      return { type: "tool_calls", calls: [{ id: "c1", name: "search_knowledge", arguments: { query: "awk" } }], continuation: {} };
    }) };
    await expect(generateWorkerCommand({ engine, context: {}, toolRegistry: createRegistry(execute), signal: controller.signal })).rejects.toThrow("worker cancelled");
    expect(engine.generateTurn).toHaveBeenCalledTimes(stage === "before-generation" ? 0 : 1);
    expect(execute).toHaveBeenCalledTimes(stage === "before-final" ? 1 : 0);
  });

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
    const registeredTools = createRegistry(execute);
    const registryExecute = vi.fn(registeredTools.execute.bind(registeredTools));
    const toolRegistry = { ...registeredTools, execute: registryExecute };
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
    expect(registryExecute).toHaveBeenCalledWith({
      name: "search_knowledge",
      arguments: { query: "  awk fields  " }
    });
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
