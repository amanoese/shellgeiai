import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createKnowledgeRetriever } from "../dist/knowledge/runtime.js";
import { createSearchKnowledgeTool } from "../dist/knowledge/runtime.js";
import { createToolRegistry } from "../dist/solve/tools.js";
import {
  WorkerToolLoopError,
  generateWorkerCommand
} from "../dist/solve/tools.js";

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
  it.each([
    ["NaN unchanged", NaN, false, 1],
    ["negative zero replaced with positive zero", -0, true, 0]
  ])("checks exact output identity before invoking typed summaries: %s", async (_label, value, replace, summaryCalls) => {
    const registry = createToolRegistry();
    const summarize = vi.fn(() => ({ resultCount: 1, recordIds: ["typed:number"] }));
    registry.register({ name: "search_knowledge", description: "Search", inputSchema: z.object({ query: z.string() }), execute: () => value, summarize });
    const originalExecute = registry.execute;
    registry.execute = async function(call) {
      const result = await originalExecute.call(this, call);
      if (replace) result.value = 0;
      return result;
    };
    const engine = createSearchingEngine();
    const result = await generateWorkerCommand({ engine, context: {}, toolRegistry: registry });
    expect(summarize).toHaveBeenCalledTimes(summaryCalls);
    expect(result.toolCalls[0]).toEqual({ name: "search_knowledge", arguments: { query: "awk" }, status: "completed", resultCount: summaryCalls, recordIds: summaryCalls ? ["typed:number"] : [] });
    expect(engine.generateTurn.mock.calls[1][0].toolResults[0].result.ok).toBe(true);
  });

  it.each(["resultCount", "recordIds"])("falls back safely when a typed summary %s getter throws", async field => {
    const registry = createToolRegistry();
    const summarize = vi.fn(() => ({
      resultCount: 1,
      recordIds: ["typed:awk"],
      get [field]() { throw new Error("private summary getter"); }
    }));
    registry.register({ name: "search_knowledge", description: "Search", inputSchema: z.object({ query: z.string() }), execute: () => ({ records: [{ id: "legacy:awk" }] }), summarize });
    const engine = createSearchingEngine();
    const result = await generateWorkerCommand({ engine, context: {}, toolRegistry: registry });
    expect(summarize).toHaveBeenCalledOnce();
    expect(result.toolCalls[0]).toEqual({ name: "search_knowledge", arguments: { query: "awk" }, status: "completed", resultCount: 1, recordIds: ["legacy:awk"] });
    expect(engine.generateTurn.mock.calls[1][0].toolResults[0].result).toEqual({ ok: true, value: { records: [{ id: "legacy:awk" }] } });
    expect(JSON.stringify(result)).not.toContain("private summary getter");
  });

  it("does not run a typed summarizer when a cancelled Tool settles later", async () => {
    const controller = new AbortController();
    const pending = Promise.withResolvers();
    const execute = vi.fn(() => pending.promise);
    const summarize = vi.fn(() => ({ resultCount: 1, recordIds: ["late"] }));
    const registry = createToolRegistry();
    registry.register({ name: "search_knowledge", description: "Search", inputSchema: z.object({ query: z.string() }), execute, summarize });
    const engine = createSearchingEngine();
    const worker = generateWorkerCommand({ engine, context: {}, toolRegistry: registry, signal: controller.signal });
    const rejected = expect(worker).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    controller.abort(new Error("cancelled"));
    await rejected;
    pending.resolve({ records: [{ id: "late" }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(summarize).not.toHaveBeenCalled();
    expect(engine.generateTurn).toHaveBeenCalledOnce();
  });

  it("uses the typed summary instead of probing records and projects only public fields", async () => {
    const registry = createToolRegistry();
    const execute = vi.fn(async () => ({ ids: ["typed:awk"], records: [{ id: "legacy:awk" }] }));
    const summarize = vi.fn(value => ({
      resultCount: value.ids.length,
      recordIds: value.ids,
      name: "spoofed", arguments: { secret: "credential" }, status: "error", records: value.records
    }));
    registry.register({ name: "search_knowledge", description: "Search", inputSchema: z.object({ query: z.string() }), execute, summarize });
    const engine = createSearchingEngine();
    const result = await generateWorkerCommand({ engine, context: {}, toolRegistry: registry });
    expect(result.toolCalls).toEqual([{ name: "search_knowledge", arguments: { query: "awk" }, status: "completed", resultCount: 1, recordIds: ["typed:awk"] }]);
    expect(execute).toHaveBeenCalledOnce();
    expect(summarize).toHaveBeenCalledOnce();
    expect(engine.generateTurn.mock.calls[1][0].toolResults[0].result).toEqual({ ok: true, value: { ids: ["typed:awk"], records: [{ id: "legacy:awk" }] } });
  });

  it("falls back to the legacy summary after a summarizer throws without failing execution", async () => {
    const registry = createToolRegistry();
    const summarize = vi.fn(() => { throw new Error("credential must not leak"); });
    registry.register({ name: "search_knowledge", description: "Search", inputSchema: z.object({ query: z.string() }), execute: () => ({ records: [{ id: "legacy:awk" }] }), summarize });
    const engine = createSearchingEngine();
    const result = await generateWorkerCommand({ engine, context: {}, toolRegistry: registry });
    expect(summarize).toHaveBeenCalledOnce();
    expect(result.toolCalls[0]).toEqual({ name: "search_knowledge", arguments: { query: "awk" }, status: "completed", resultCount: 1, recordIds: ["legacy:awk"] });
    expect(engine.generateTurn.mock.calls[1][0].toolResults[0].result).toEqual({ ok: true, value: { records: [{ id: "legacy:awk" }] } });
    expect(JSON.stringify(result)).not.toContain("credential");
  });

  it.each(["mutate-records", "replace-value", "replace-result", "mark-error"])("honors execute hooks and receiver before summarizing: %s", async mode => {
    const registry = createToolRegistry();
    const summarize = vi.fn(value => ({ resultCount: value.records.length, recordIds: value.records.map(record => `typed:${record.id}`) }));
    registry.register({ name: "search_knowledge", description: "Search", inputSchema: z.object({ query: z.string() }), execute: () => ({ records: [{ id: "original" }] }), summarize });
    const originalExecute = registry.execute;
    const injected = { ...registry, marker: "receiver", execute: vi.fn(async function(call) {
      expect(this.marker).toBe("receiver");
      const result = await originalExecute.call(this, call);
      if (mode === "mutate-records") result.value.records.push({ id: "hooked" });
      if (mode === "replace-value") result.value = { records: [{ id: "replacement" }] };
      if (mode === "replace-result") return { ...result, value: { records: [{ id: "replacement" }] }, summary: { secret: "credential" } };
      if (mode === "mark-error") { result.ok = false; result.error = { code: "tool_execution_failed", message: "Hook failed." }; }
      return result;
    }) };
    const engine = createSearchingEngine();
    const result = await generateWorkerCommand({ engine, context: {}, toolRegistry: injected });
    expect(injected.execute).toHaveBeenCalledOnce();
    expect(result.toolCalls[0]).toEqual({ name: "search_knowledge", arguments: { query: "awk" }, status: mode === "mark-error" ? "error" : "completed", resultCount: mode === "mutate-records" ? 2 : mode === "mark-error" ? 0 : 1, recordIds: mode === "mutate-records" ? ["typed:original", "typed:hooked"] : mode === "mark-error" ? [] : ["replacement"] });
    expect(summarize).toHaveBeenCalledTimes(mode === "mutate-records" ? 1 : 0);
    const publicResult = engine.generateTurn.mock.calls[1][0].toolResults[0].result;
    expect(Object.keys(publicResult).sort()).toEqual(mode === "mark-error" ? ["error", "ok"] : ["ok", "value"]);
  });

  it("executes an injected legacy registry with its receiver and safely extracts legacy records", async () => {
    const registry = { definitions: () => [], marker: "legacy", execute: vi.fn(async function() {
      expect(this.marker).toBe("legacy");
      return { ok: true, value: { records: [{ id: "legacy:awk" }, null, { id: 3 }, { id: "" }] }, validatedArguments: { query: "awk" } };
    }) };
    const result = await generateWorkerCommand({ engine: createSearchingEngine(), context: {}, toolRegistry: registry });
    expect(registry.execute).toHaveBeenCalledOnce();
    expect(result.toolCalls[0]).toEqual({ name: "search_knowledge", arguments: { query: "awk" }, status: "completed", resultCount: 4, recordIds: ["legacy:awk"] });
  });

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
