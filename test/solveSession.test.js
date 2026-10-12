import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportSessionPhase } from "../dist/solve/session/progress.js";
import { createSolveSession } from "../dist/solve/session/solveSession.js";
import { SESSION_PHASES } from "../dist/solve/session/sessionPhases.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";
import { buildKnowledgeVectors } from "../dist/knowledge/commands.js";
import { documentEmbedder, knowledgeFixture } from "./support/knowledgeFixture.js";
import { OpenAIEngine } from "../dist/providers/engines/openaiEngine.js";
import { resolveLlmConfig } from "../dist/providers/llm/config.js";

afterEach(() => vi.unstubAllEnvs());

describe("SESSION_PHASES", () => {
  it("defines ordered main solve phases", () => {
    expect(SESSION_PHASES).toEqual([
      "initializing",
      "problem-parsing",
      "planning",
      "executing",
      "selecting",
      "logging",
      "completed"
    ]);
  });
});

describe("progress helpers", () => {
  it("reports session-phase events with ordering metadata", () => {
    const events = [];
    const session = {
      sessionId: "session-1",
      onProgress: (event) => events.push(event)
    };

    reportSessionPhase(session, "planning", "Building execution plan.");

    expect(events).toEqual([
      {
        type: "session-phase",
        sessionId: "session-1",
        phase: "planning",
        phaseIndex: 3,
        phaseCount: 7,
        message: "Building execution plan."
      }
    ]);
  });
});

describe("createSolveSession", () => {
  it("owns resolved default Planner settings for a programmatic mock Worker", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("SHELLGEIAI_LLM_API_KEY", "mock-planner-key");
    vi.stubEnv("SHELLGEIAI_LLM_MODEL", "worker-model");
    vi.stubEnv("SHELLGEIAI_PLANNER_MODEL", "planner-model");
    const parse = vi.fn(async () => ({ output_parsed: await createTestPlannerProvider().buildPlan() }));
    const { plannerProvider: _plannerProvider, ...options } = sessionOptions();
    const session = await createSolveSession({ ...options, engine: { ...options.engine, client: { responses: { parse } } } });
    try {
      expect(session.llmConfig).toMatchObject({ provider: "openrouter", apiKey: "mock-planner-key", model: "worker-model", plannerModel: "planner-model" });
      expect(session.plannerProvider.name).toBe("llm");
      expect(parse.mock.calls[0][0].model).toBe(session.llmConfig.plannerModel);
    } finally { await session.dispose(); }
  });

  it("validates Worker capabilities before default Planner credentials", async () => {
    vi.stubEnv("SHELLGEIAI_LLM_API_KEY", "");
    const { plannerProvider: _plannerProvider, ...options } = sessionOptions();
    await expect(createSolveSession({ ...options, knowledgeMode: "worker", engine: { name: "legacy", generateCommand: vi.fn() } })).rejects.toThrow("does not support Tool Calling");
  });

  it.each(["explicit", "engine"])("configures the default Planner from %s common settings", async source => {
    const config = resolveLlmConfig({ apiKey: "test-key", baseURL: "https://api.openai.com/v1", model: "worker-model", plannerModel: "planner-model" }, { env: {} });
    const parse = vi.fn(async () => ({ output_parsed: await createTestPlannerProvider().buildPlan() }));
    const clientFactory = vi.fn(async () => ({ responses: { parse } }));
    const engine = new OpenAIEngine({ config, clientFactory });
    const { plannerProvider: _plannerProvider, ...options } = sessionOptions();
    const session = await createSolveSession({ ...options, engine, ...(source === "explicit" ? { llmConfig: config } : {}) });
    try {
      expect(session.llmConfig).toBe(config);
      expect(parse.mock.calls[0][0]).toMatchObject({ model: "planner-model", store: false });
      expect(parse.mock.calls[0][1]).toEqual({ signal: session.signal });
      expect(clientFactory).toHaveBeenCalledWith({ apiKey: "test-key", baseURL: config.baseURL,
        timeoutMs: config.timeoutMs, maxRetries: config.maxRetries });
      expect(session.plan.planner.provider).toBe("llm");
    } finally { await session.dispose(); }
  });

  it("preserves an injected Planner even with explicit common settings", async () => {
    const config = resolveLlmConfig({ apiKey: "test-key" }, { env: {} });
    const options = sessionOptions();
    const session = await createSolveSession({ ...options, llmConfig: config });
    try {
      expect(session.plannerProvider).toBe(options.plannerProvider);
      expect(session.llmConfig).toBe(config);
    } finally { await session.dispose(); }
  });

  it.each(["deadline", "external"])("passes %s cancellation through the default Planner SDK call", async source => {
    const config = resolveLlmConfig({ apiKey: "test-key", timeoutMs: 30000 }, { env: {} });
    const external = new AbortController();
    let receivedSignal;
    const parse = vi.fn(async (_request, { signal }) => {
      receivedSignal = signal;
      if (source === "external") external.abort(new Error("external planner cancellation"));
      return new Promise(() => {});
    });
    const { plannerProvider: _plannerProvider, ...options } = sessionOptions();
    await expect(createSolveSession({ ...options, engine: new OpenAIEngine({ config, client: { responses: { parse } } }),
      signal: external.signal, ...(source === "deadline" ? { timeBudgetMs: 20 } : {})
    })).rejects.toThrow(source === "deadline" ? /time budget/ : /external planner cancellation/);
    expect(parse).toHaveBeenCalledOnce();
    expect(receivedSignal.aborted).toBe(true);
  });

  it("normalizes read-only devices for Docker sessions", async () => {
    const session = await createSolveSession({
      problemInput: "inspect device",
      engine: {
        name: "mock",
        generateCommand: async () => ({ command: "true" })
      },
      runner: { name: "docker" },
      judge: { judge: async () => ({ passed: true, reason: "ok" }) },
      maxIterations: 1,
      dockerDevicesReadonly: ["/dev/null", "/dev/null"],
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.dockerDevicesReadonly).toEqual(["/dev/null"]);
  });

  it("rejects read-only Docker devices with a local runner", async () => {
    await expect(
      createSolveSession({
        problemInput: "inspect device",
        engine: {
          name: "mock",
          generateCommand: async () => ({ command: "true" })
        },
        runner: { name: "local" },
        judge: { judge: async () => ({ passed: true, reason: "ok" }) },
        maxIterations: 1,
        dockerDevicesReadonly: ["/dev/null"],
        plannerProvider: createTestPlannerProvider()
      })
    ).rejects.toThrow("use --runner docker");
  });

  it("defaults shellgei score mode simple", async () => {
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.shellgeiScoreMode).toBe("simple");
  });

  it("defaults knowledge mode off", async () => {
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.knowledgeMode).toBe("off");
  });
  it("reports initializing, problem-parsing, and planning in order", async () => {
    const events = [];
    const session = await createSolveSession({ ...sessionOptions(), onProgress: event => events.push(event) });
    expect(events.filter(event => event.type === "session-phase").map(event => event.phase)).toEqual([
      "initializing", "problem-parsing", "planning"
    ]);
    await session.dispose();
  });

  it("normalizes programmatic on knowledge mode to all before capability validation", async () => {
    await expect(
      createSolveSession({
        problemInput: "print 42",
        engine: { name: "legacy", generateCommand: async () => ({ command: "printf '42\\n'" }) },
        runner: { name: "mock" },
        judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
        maxIterations: 1,
        knowledgeMode: "on",
        knowledgeRetriever: { retrieveForPlanner: async () => [] },
        plannerProvider: createTestPlannerProvider()
      })
    ).rejects.toThrow(
      'Engine "legacy" does not support Tool Calling required by --knowledge all. Use a Tool Calling capable engine, or select --knowledge planner/off.'
    );
  });

  it.each([
    { label: "false", capabilities: { toolCalling: false }, engineName: "legacy" },
    { label: "missing", capabilities: undefined, engineName: undefined },
    {
      label: "true without generateTurn",
      capabilities: { toolCalling: true },
      engineName: "incomplete-tool-engine"
    }
  ])(
    "rejects worker knowledge when Tool Calling capability is $label before retrieval and planning",
    async ({ capabilities, engineName }) => {
      const retrieveForPlanner = vi.fn(async () => []);
      const plannerProvider = createTestPlannerProvider();
      const buildPlan = vi.spyOn(plannerProvider, "buildPlan");

      await expect(
        createSolveSession({
          problemInput: "print 42",
          engine: {
            ...(engineName ? { name: engineName } : {}),
            ...(capabilities ? { capabilities } : {}),
            generateCommand: async () => ({ command: "printf '42\\n'" })
          },
          runner: { name: "mock" },
          judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
          maxIterations: 1,
          knowledgeMode: "all",
          knowledgeRetriever: { retrieveForPlanner, search: vi.fn() },
          plannerProvider
        })
      ).rejects.toThrow(
        `Engine "${engineName ?? "unknown"}" does not support Tool Calling required by --knowledge all. Use a Tool Calling capable engine, or select --knowledge planner/off.`
      );
      expect(retrieveForPlanner).not.toHaveBeenCalled();
      expect(buildPlan).not.toHaveBeenCalled();
    }
  );

  it("registers only search_knowledge for capable worker knowledge sessions", async () => {
    const knowledgeRetriever = { search: vi.fn(async () => []) };
    const session = await createSolveSession({
      problemInput: "print 42",
      engine: {
        name: "tool-engine",
        capabilities: { toolCalling: true },
        generateTurn: vi.fn()
      },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      knowledgeMode: "worker",
      knowledgeRetriever,
      plannerProvider: createTestPlannerProvider()
    });

    expect(session.toolRegistry.definitions().map((definition) => definition.name)).toEqual([
      "search_knowledge"
    ]);
    expect(session.knowledgeRetriever).toBe(knowledgeRetriever);
  });

  it("retrieves planner knowledge before planning without injecting worker hints", async () => {
    const events = [];
    const plannerKnowledgeHints = [
      {
        id: "man:awk:-F",
        command: "awk",
        option: "-F",
        text: "Split input fields.",
        source: "test"
      }
    ];
    const knowledgeRetriever = {
      retrieveForPlanner: vi.fn(async (input) => {
        events.push({ type: "retrieve", input });
        return plannerKnowledgeHints;
      })
    };
    const basePlannerProvider = createTestPlannerProvider();
    const plannerProvider = {
      ...basePlannerProvider,
      buildPlan: vi.fn(async (plannerSession) => {
        events.push({
          type: "plan",
          plannerKnowledgeHints: plannerSession.plannerKnowledgeHints
        });
        return basePlannerProvider.buildPlan(plannerSession);
      })
    };

    const session = await createSolveSession({
      problemInput: "expected_output:\n42\n---\nCSV の 3列目を合計する",
      engine: { name: "mock", generateCommand: async () => ({ command: "printf '42\\n'" }) },
      runner: { name: "mock" },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      maxIterations: 1,
      parallelism: 2,
      knowledgeMode: "planner",
      knowledgeRetriever,
      plannerProvider
    });

    expect(events).toEqual([
      {
        type: "retrieve",
        input: {
          problem: "CSV の 3列目を合計する",
          expectedOutput: "42"
        }
      },
      { type: "plan", plannerKnowledgeHints }
    ]);
    expect(session.plannerKnowledgeHints).toEqual(plannerKnowledgeHints);
    expect(session.plan.workerTasks).toHaveLength(2);
    expect(session.plan.workerTasks.every((task) => !("knowledgeHints" in task))).toBe(true);
  });


  it.each([
    { knowledgeMode: "planner", queryCount: 1 },
    { knowledgeMode: "worker", queryCount: 0 },
    { knowledgeMode: "all", queryCount: 1 }
  ])("loads and routes persisted $knowledgeMode knowledge", async ({ knowledgeMode, queryCount }) => {
    const fixture = await knowledgeFixture();
    const built = await buildKnowledgeVectors({ ...fixture, embedder: documentEmbedder() });
    const embed = vi.fn(async () => [1, 0]);
    const knowledgeEmbedderFactory = vi.fn(() => ({ embed }));
    const session = await createSolveSession({
      ...sessionOptions(), knowledgeMode, knowledgeModel: fixture.model, knowledgeDbPath: fixture.dbPath,
      knowledgeDatasetPath: fixture.datasetPath, knowledgeEmbedderFactory
    });
    try {
      expect(session.plannerKnowledgeHints.length > 0).toBe(queryCount > 0);
      expect(embed).toHaveBeenCalledTimes(queryCount);
      expect(knowledgeEmbedderFactory).toHaveBeenCalledWith({ model: fixture.model });
      expect(session.knowledgeSnapshot).toMatchObject({ dbPath: fixture.dbPath, generationId: built.generationId, dimensions: 2 });
      expect(session.plan.workerTasks.every(task => !("knowledgeHints" in task))).toBe(true);
      if (knowledgeMode !== "planner") expect(session.toolRegistry.definitions()).toHaveLength(1);
    } finally { await session.dispose(); await fs.rm(fixture.dir, { recursive: true, force: true }); }
  });

  it("does not initialize runtime or provider with knowledge off", async () => {
    const knowledgeRuntimeFactory = vi.fn();
    const knowledgeEmbedderFactory = vi.fn();
    const session = await createSolveSession({ ...sessionOptions(), knowledgeRuntimeFactory, knowledgeEmbedderFactory, knowledgeMode: "off" });
    expect(knowledgeRuntimeFactory).not.toHaveBeenCalled();
    expect(knowledgeEmbedderFactory).not.toHaveBeenCalled();
    await session.dispose();
  });

  it("validates persisted DB before provider construction", async () => {
    const fixture = await knowledgeFixture();
    const knowledgeEmbedderFactory = vi.fn();
    try {
      await expect(createSolveSession({ ...sessionOptions(), knowledgeMode: "planner", knowledgeDatasetPath: fixture.datasetPath,
        knowledgeDbPath: fixture.dbPath, knowledgeEmbedderFactory })).rejects.toThrow("knowledge build");
      expect(knowledgeEmbedderFactory).not.toHaveBeenCalled();
    } finally { await fs.rm(fixture.dir, { recursive: true, force: true }); }
  });

  it("does not dispose an injected caller-owned retriever", async () => {
    const knowledgeRetriever = { retrieveForPlanner: async () => [], dispose: vi.fn() };
    const session = await createSolveSession({ ...sessionOptions(), knowledgeMode: "planner", knowledgeRetriever });
    await session.dispose();
    expect(knowledgeRetriever.dispose).not.toHaveBeenCalled();
  });

  it.each(["prefetch", "planning"])("disposes runtime if initialization fails in %s", async stage => {
    const runtime = { retriever: { retrieveForPlanner: async () => {
      if (stage === "prefetch") throw new Error("prefetch failed");
      return [];
    } }, snapshot: {}, dispose: vi.fn(async () => {}) };
    const plannerProvider = stage === "planning" ? { buildPlan: async () => { throw new Error("planning failed"); } } : createTestPlannerProvider();
    await expect(createSolveSession({ ...sessionOptions(), knowledgeMode: "planner", plannerProvider,
      knowledgeRuntimeFactory: async () => runtime })).rejects.toThrow(stage + " failed");
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("aborts deadline during query even when the provider ignores its signal", async () => {
    const fixture = await knowledgeFixture();
    await buildKnowledgeVectors({ ...fixture, embedder: documentEmbedder() });
    let signal;
    try {
      await expect(createSolveSession({ ...sessionOptions(), knowledgeMode: "planner", knowledgeModel: fixture.model,
        knowledgeDbPath: fixture.dbPath, knowledgeDatasetPath: fixture.datasetPath, timeBudgetMs: 30,
        knowledgeEmbedder: { embed: async (_text, options) => { signal = options.signal; return new Promise(() => {}); } }
      })).rejects.toThrow("time budget");
      expect(signal.aborted).toBe(true);
    } finally { await fs.rm(fixture.dir, { recursive: true, force: true }); }
  });

  it("links external abort and disposes its timer after factory failure", async () => {
    const controller = new AbortController();
    let received;
    await expect(createSolveSession({ ...sessionOptions(), knowledgeMode: "planner", signal: controller.signal,
      knowledgeRuntimeFactory: async options => { received = options.signal; controller.abort(new Error("external abort")); throw received.reason; }
    })).rejects.toThrow("external abort");
    expect(received.aborted).toBe(true);
  });
  it("cleans up if external cancellation occurs during planning", async () => {
    const controller = new AbortController();
    const runtime = { retriever: { retrieveForPlanner: async () => [] }, snapshot: {}, dispose: vi.fn(async () => {}) };
    const base = createTestPlannerProvider();
    await expect(createSolveSession({ ...sessionOptions(), knowledgeMode: "planner", signal: controller.signal,
      knowledgeRuntimeFactory: async () => runtime, plannerProvider: { buildPlan: async session => {
        controller.abort(new Error("cancelled during planning"));
        return base.buildPlan(session);
      } }
    })).rejects.toThrow("cancelled during planning");
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
  it.each(["prefetch", "planning"])("bounds an injected %s that ignores cancellation", async stage => {
    const runtime = { retriever: { retrieveForPlanner: async () => stage === "prefetch" ? new Promise(() => {}) : [] },
      snapshot: {}, dispose: vi.fn(async () => {}) };
    const plannerProvider = stage === "planning" ? { buildPlan: async () => new Promise(() => {}) } : createTestPlannerProvider();
    await expect(createSolveSession({ ...sessionOptions(), knowledgeMode: "planner", timeBudgetMs: 20,
      knowledgeRuntimeFactory: async () => runtime, plannerProvider })).rejects.toThrow("time budget");
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });
});

function sessionOptions() {
  return {
    problemInput: "print 42",
    engine: { name: "mock", capabilities: { toolCalling: true },
      generateCommand: async () => ({ command: "printf '42\\n'" }),
      generateTurn: async () => ({ type: "command", command: "printf '42\\n'" }) },
    runner: { name: "mock" }, judge: { judge: async () => ({ passed: true, reason: "ok" }) },
    maxIterations: 1, plannerProvider: createTestPlannerProvider()
  };
}
