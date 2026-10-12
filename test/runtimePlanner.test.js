import { afterEach, describe, expect, it, vi } from "vitest";

import { createExecutionPlan } from "../dist/solve/solve.js";
import { createSolveRuntime } from "../dist/solve/runtime.js";
import { OpenAIEngine } from "../dist/providers/apiEngine.js";
import { DockerRunner } from "../dist/execution/dockerRunner.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("createExecutionPlan", () => {
  it("uses the LLM planner by default", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("SHELLGEIAI_LLM_API_KEY", "");

    await expect(
      createExecutionPlan({
        mode: "parallel",
        parallelism: 3,
        maxIterations: 2
      })
    ).rejects.toThrow("apiKey / SHELLGEIAI_LLM_API_KEY");
  });

  it("preserves unknown metadata returned by an injected Planner", async () => {
    const raw = await createTestPlannerProvider().buildPlan();
    const metadata = { promptVersion: 17, prompt: ["injected", "prompt"], rawResponse: { opaque: true } };
    const plan = await createExecutionPlan({ parallelism: 2, maxIterations: 1,
      plannerProvider: { name: "injected", buildPlan: async () => ({ plan: raw, ...metadata }) } });
    expect(plan.planner.promptVersion).toBe(metadata.promptVersion);
    expect(plan.planner.prompt).toBe(metadata.prompt);
    expect(plan.planner.rawResponse).toBe(metadata.rawResponse);
  });

  it.each([null, {}, { variants: [] }, { plan: { variants: [] } }])("rejects invalid injected planner output %j", async rawPlan => {
    await expect(createExecutionPlan({ parallelism: 2, maxIterations: 1,
      plannerProvider: { buildPlan: async () => rawPlan } })).rejects.toThrow();
  });

  it("returns worker tasks from LLM planner variants", async () => {
    const plan = await createExecutionPlan({
      mode: "parallel",
      parallelism: 3,
      maxIterations: 2,
      plannerProvider: createTestPlannerProvider()
    });

    expect(plan).toEqual(
      expect.objectContaining({
        mode: "parallel",
        parallelism: 3,
        workerTasks: [
          expect.objectContaining({
            workerId: "worker-1",
            strategy: "direct-shell",
            assignedVariant: expect.objectContaining({ variantId: "variant-1" }),
            strategyProfile: expect.objectContaining({
              name: "direct-shell",
              focus: "Use a direct shell pipeline.",
              retryHint: "Prefer the simplest command that can produce the expected output.",
              rubricFocus: ["awk", "sed"]
            }),
            maxAttempts: 2
          }),
          expect.objectContaining({
            workerId: "worker-2",
            strategyProfile: expect.objectContaining({
              name: "pipeline-shell",
              rubricFocus: ["grep", "sort"]
            })
          }),
          expect.objectContaining({
            workerId: "worker-3",
            strategyProfile: expect.objectContaining({
              name: "direct-shell"
            })
          })
        ]
      })
    );
  });

  it("normalizes LLM variants and assigns one to each worker", async () => {
    const plan = await createExecutionPlan({
      mode: "parallel",
      parallelism: 4,
      maxIterations: 2,
      plannerProvider: createTestPlannerProvider(),
      problem: {
        raw: "1から100までの素数を出力してください",
        problemText: "1から100までの素数を出力してください"
      }
    });

    expect(plan.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: expect.any(String),
          label: expect.any(String),
          approach: expect.any(String),
          toolBias: expect.any(Array),
          toolSuggestions: expect.any(Array)
        })
      ])
    );
    expect(plan.variants[0].toolSuggestions[0]).toEqual(
      expect.objectContaining({
        summary: expect.any(String),
        rationale: expect.any(String),
        suggestedTools: expect.any(Array)
      })
    );
    expect(plan.workerTasks).toHaveLength(4);
    expect(plan.workerTasks[0].assignedVariant).toEqual(plan.variants[0]);
  });
});

describe("createSolveRuntime", () => {
  it.each(["llm", "openai"])("honors explicit %s fetch without using the inherited direct client", async optionName => {
    const plan = await createTestPlannerProvider().buildPlan();
    const inheritedParse = vi.fn(async () => ({ output_parsed: plan }));
    const engine = new OpenAIEngine({ client: { responses: { parse: inheritedParse } } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "explicit-fetch", status: "completed",
      output: [{ type: "message", id: "message-1", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(plan), annotations: [] }] }]
    }), { headers: { "content-type": "application/json" } }));
    const runtime = createSolveRuntime({ engine, [optionName]: { fetchImpl } });
    await runtime.plannerProvider.buildPlan({ problem: { problemText: "print 123" }, maxIterations: 1 });
    expect(inheritedParse).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps explicit Planner client precedence over explicit fetch", async () => {
    const inheritedParse = vi.fn();
    const engine = new OpenAIEngine({ client: { responses: { parse: inheritedParse } } });
    const parse = vi.fn(async () => ({ output_parsed: await createTestPlannerProvider().buildPlan() }));
    const fetchImpl = vi.fn();
    const runtime = createSolveRuntime({ engine, llm: { client: { responses: { parse } }, fetchImpl } });
    await runtime.plannerProvider.buildPlan({ problem: { problemText: "print 123" }, maxIterations: 1 });
    expect(parse).toHaveBeenCalledOnce();
    expect(inheritedParse).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["client", "clientFactory"])("inherits an injected API Engine's %s without default networking", async source => {
    const plan = await createTestPlannerProvider().buildPlan();
    const defaultFetch = vi.fn(async () => new Response(JSON.stringify({ id: "default-network", status: "completed",
      output: [{ type: "message", id: "message-1", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(plan), annotations: [] }] }]
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", defaultFetch);
    const parse = vi.fn(async () => ({ output_parsed: plan }));
    const client = { responses: { parse } };
    const clientFactory = vi.fn(async () => client);
    const fetchImpl = vi.fn();
    const engine = new OpenAIEngine({ apiKey: "test-key", fetchImpl,
      ...(source === "client" ? { client } : { clientFactory }) });
    const runtime = createSolveRuntime({ engine });
    expect(runtime.engine).toBe(engine);
    expect(runtime.llmConfig).toBe(engine.llmConfig);
    expect(clientFactory).not.toHaveBeenCalled();
    await runtime.plannerProvider.buildPlan({ problem: { problemText: "print 123" }, maxIterations: 1 });
    await runtime.plannerProvider.buildPlan({ problem: { problemText: "print 456" }, maxIterations: 1 });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(defaultFetch).not.toHaveBeenCalled();
    expect(clientFactory).toHaveBeenCalledTimes(source === "clientFactory" ? 1 : 0);
    if (source === "clientFactory") expect(clientFactory.mock.calls[0][0]).toMatchObject({
      apiKey: engine.llmConfig.apiKey, baseURL: engine.llmConfig.baseURL, fetchImpl });
  });

  it.each(["llm", "openai"])("honors explicit %s Planner factory and fetch over inherited Engine DI", async optionName => {
    const engineParse = vi.fn();
    const engine = new OpenAIEngine({ client: { responses: { parse: engineParse } } });
    const parse = vi.fn(async () => ({ output_parsed: await createTestPlannerProvider().buildPlan() }));
    const clientFactory = vi.fn(async () => ({ responses: { parse } }));
    const fetchImpl = vi.fn();
    const runtime = createSolveRuntime({ engine, [optionName]: { clientFactory, fetchImpl } });
    await runtime.plannerProvider.buildPlan({ problem: { problemText: "print 123" }, maxIterations: 1 });
    expect(engineParse).not.toHaveBeenCalled();
    expect(parse).toHaveBeenCalledOnce();
    expect(clientFactory).toHaveBeenCalledWith(expect.objectContaining({ fetchImpl }));
  });

  it("creates default OpenAI engine and Docker runner", () => {
    const runtime = createSolveRuntime({
      openai: {
        apiKey: "test-key",
        client: {
          responses: {
            create: vi.fn(async () => ({
              output_text: '{"command":"printf \\"ok\\\\n\\"","explanation":"test"}'
            }))
          }
        }
      }
    });

    expect(runtime.engine).toBeInstanceOf(OpenAIEngine);
    expect(runtime.runner).toBeInstanceOf(DockerRunner);
  });

  it("creates docker runner when requested", () => {
    const runtime = createSolveRuntime({ engine: "mock", runner: "docker", llm: { apiKey: "test-key" } });

    expect(runtime.runner).toBeInstanceOf(DockerRunner);
    expect(runtime.runner.name).toBe("docker");
  });

  it("resolves common API configuration once and gives llm precedence over legacy openai", async () => {
    const parse = vi.fn(async () => ({ output_parsed: await createTestPlannerProvider().buildPlan() }));
    const client = { responses: { parse, create: vi.fn() } };
    const runtime = createSolveRuntime({ engine: "api", openai: { apiKey: "legacy", baseURL: "https://api.openai.com/v1" },
      llm: { apiKey: "test-key", model: "openai/gpt-6.1-sol", plannerModel: "planner-override", client } });
    expect(runtime.llmConfig).toBe(runtime.engine.llmConfig);
    expect(runtime.llmConfig).toMatchObject({ provider: "openrouter", apiKey: "test-key", plannerModel: "planner-override" });
    expect(runtime.engine.client).toBe(client);
    await runtime.plannerProvider.buildPlan({ problem: { problemText: "print 123" }, maxIterations: 1 });
    expect(parse.mock.calls[0][0]).toMatchObject({ model: "planner-override", store: false });
  });

  it("preserves both injected providers without requiring API credentials", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("SHELLGEIAI_LLM_API_KEY", "");
    const engine = { name: "fake", generateCommand: vi.fn() };
    const plannerProvider = createTestPlannerProvider();
    const runtime = createSolveRuntime({ engine, plannerProvider });
    expect(runtime.engine).toBe(engine);
    expect(runtime.plannerProvider).toBe(plannerProvider);
    expect(runtime.llmConfig).toBeUndefined();
  });

  it("still requires a configured LLM planner with a mock Worker", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("SHELLGEIAI_LLM_API_KEY", "");
    expect(() => createSolveRuntime({ engine: "mock" })).toThrow(/apiKey/);
  });

  it.each([
    [{ engine: "unsupported" }, "Unsupported engine: unsupported"],
    [{ runner: "unsupported" }, "Unsupported runner: unsupported"]
  ])("reports invalid runtime options before credential validation", (config, message) => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("SHELLGEIAI_LLM_API_KEY", "");
    expect(() => createSolveRuntime(config)).toThrow(message);
  });

  it.each(["llm", "openai"])("preserves %s lazy factory and fetch injection for both providers", async optionName => {
    const client = { responses: {
      create: vi.fn(async () => ({ output_text: '{"command":"printf 123"}' })),
      parse: vi.fn(async () => ({ output_parsed: await createTestPlannerProvider().buildPlan() }))
    } };
    const clientFactory = vi.fn(async () => client);
    const fetchImpl = vi.fn();
    const options = { apiKey: "test-key", baseURL: "https://example.com/v1", model: "worker-model",
      timeoutMs: 17, maxRetries: 0, clientFactory, fetchImpl };
    const runtime = createSolveRuntime({ [optionName]: options });
    expect(clientFactory).not.toHaveBeenCalled();
    await runtime.engine.generateCommand({ problem: "print 123", attempts: [], workdir: "/tmp" });
    await runtime.plannerProvider.buildPlan({ problem: { problemText: "print 123" }, maxIterations: 1 });
    expect(clientFactory).toHaveBeenCalledTimes(2);
    for (const [request] of clientFactory.mock.calls) expect(request).toEqual({ apiKey: options.apiKey,
      baseURL: options.baseURL, timeoutMs: 17, maxRetries: 0, fetchImpl });
    expect(client.responses.create.mock.calls[0][0].model).toBe("worker-model");
    expect(client.responses.parse.mock.calls[0][0].model).toBe("worker-model");
  });
});
