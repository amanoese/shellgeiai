import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLlmConfig } from "../dist/providers/llm.js";
import { createSolveRuntime } from "../dist/solve/runtime.js";

const plan = { variants: [{
  variantId: "direct", label: "printf-first", approach: "Print the value directly.",
  toolBias: ["printf"], intent: "Produce deterministic output.", constraints: ["Keep it safe."],
  avoid: ["Network access."], explorationHint: "Use printf.", toolSuggestions: []
}] };
const command = { command: "printf '123\\n'", explanation: "Print the expected value." };
const session = { problem: { problemText: "print 123", expectedOutput: "123" }, parallelism: 2, maxIterations: 1 };
const context = { problem: "print 123", attempts: [], workdir: "/tmp/workdir", workerId: "worker-1" };
const tools = [{
  name: "search_knowledge", description: "Search optional local knowledge.",
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }
}];

function message(value) {
  return { type: "message", id: "msg-fixture", status: "completed", role: "assistant",
    content: [{ type: "output_text", text: JSON.stringify(value), annotations: [] }] };
}

// A queued transport exercises the installed SDK, never a mocked SDK or a live API.
function transport(outputs) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)),
      redirect: init.redirect, body: JSON.parse(init.body) });
    if (!outputs.length) throw new Error("Unexpected request beyond the fixture queue.");
    return new Response(JSON.stringify({ id: `resp-${requests.length}`, object: "response", status: "completed",
      output: outputs.shift(), error: null, incomplete_details: null }), {
      headers: { "content-type": "application/json" }
    });
  };
  return { requests, fetchImpl };
}

afterEach(() => vi.unstubAllEnvs());

describe("offline Responses provider contract with the real SDK", () => {
  it.each([
    { label: "default OpenRouter", env: { OPENROUTER_API_KEY: "router-fixture", OPENAI_API_KEY: "unused-openai" },
      provider: "openrouter", url: "https://openrouter.ai/api/v1/responses", key: "router-fixture", model: "openai/gpt-6.1-sol" },
    { label: "explicit OpenAI", env: { LLM_BASE_URL: "https://api.openai.com/v1", OPENAI_API_KEY: "openai-fixture", OPENROUTER_API_KEY: "unused-router" },
      provider: "openai", url: "https://api.openai.com/v1/responses", key: "openai-fixture", model: "gpt-6.1-sol" },
    { label: "explicit custom gateway", env: { LLM_BASE_URL: "https://gateway.invalid/v1", SHELLGEIAI_LLM_API_KEY: "gateway-fixture",
      SHELLGEIAI_LLM_MODEL: "gateway-model", OPENAI_API_KEY: "unused-openai", OPENROUTER_API_KEY: "unused-router" },
      provider: "custom", url: "https://gateway.invalid/v1/responses", key: "gateway-fixture", model: "gateway-model" }
  ])("routes Planner and Worker to $label with the same credentials and inherited model", async ({ env, provider, url, key, model }) => {
    vi.stubEnv("OPENAI_ORG_ID", "ambient-organization");
    vi.stubEnv("OPENAI_PROJECT_ID", "ambient-project");
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", "X-Secret: ambient-secret");
    const fake = transport([[message(plan)], [message(command)]]);
    const llmConfig = resolveLlmConfig({ maxRetries: 0 }, { env });
    const runtime = createSolveRuntime({ llmConfig, llm: { fetchImpl: fake.fetchImpl } });

    expect(runtime.llmConfig).toMatchObject({ provider, model, plannerModel: model, timeoutMs: 30000, maxRetries: 0 });
    expect((await runtime.plannerProvider.buildPlan(session)).variants).toEqual(plan.variants);
    expect(await runtime.engine.generateCommand(context)).toEqual(command);
    expect(runtime.engine.client.timeout).toBe(30000);
    expect(runtime.engine.client.maxRetries).toBe(0);
    expect(fake.requests).toHaveLength(2);
    for (const request of fake.requests) {
      expect(request.url).toBe(url);
      expect(request.headers).toEqual({ accept: "application/json", "content-type": "application/json", authorization: `Bearer ${key}` });
      expect(request.redirect).toBe("error");
      expect(request.body).toMatchObject({ model, store: false });
      expect(request.body).not.toHaveProperty("previous_response_id");
      if (provider === "custom") expect(request.body).not.toHaveProperty("include");
      else expect(request.body.include).toEqual(["reasoning.encrypted_content"]);
    }
    const format = fake.requests[0].body.text.format;
    expect(format).toMatchObject({ type: "json_schema", name: "shellgeiai_planner_plan", strict: true,
      schema: { type: "object", required: ["variants"], additionalProperties: false } });
    expect(format.schema.properties.variants.items.required).toContain("toolSuggestions");
    expect(fake.requests[0].body.input[1].content[0].text).toContain("Problem: print 123");
    expect(fake.requests[1].body).not.toHaveProperty("text");
    expect(fake.requests[1].body.input[1].content[0].text).toContain("Worker: worker-1");
  });

  it("preserves the complete reasoning and function output in a stateless Tool turn", async () => {
    const output = [
      { type: "reasoning", id: "reasoning-private", summary: [], encrypted_content: "encrypted-fixture-private" },
      { type: "function_call", id: "fc-fixture", status: "completed", call_id: "call-fixture",
        name: "search_knowledge", arguments: '{"query":"printf"}' },
      { type: "reasoning", id: "reasoning-after", summary: [{ type: "summary_text", text: "Use the search result." }],
        encrypted_content: "encrypted-fixture-after" }
    ];
    const fake = transport([output, [message(command)]]);
    const llmConfig = resolveLlmConfig({ maxRetries: 0 }, { env: { OPENROUTER_API_KEY: "router-fixture" } });
    const { engine } = createSolveRuntime({ llmConfig, llm: { fetchImpl: fake.fetchImpl } });
    const first = await engine.generateTurn({ context, tools });
    expect(first.type).toBe("tool_calls");
    expect(first.calls).toEqual([{ id: "call-fixture", name: "search_knowledge", arguments: { query: "printf" } }]);
    const initialInput = fake.requests[0].body.input;
    expect(first.continuation).toEqual({ input: [...initialInput, ...output] });
    const result = { records: [{ id: "printf-reference", text: "private Tool result body" }] };
    const final = await engine.generateTurn({ context, tools, continuation: first.continuation,
      toolResults: [{ callId: "call-fixture", result }] });
    expect(final).toEqual({ type: "command", ...command });
    expect(fake.requests[1].body.input).toEqual([...initialInput, ...output,
      { type: "function_call_output", call_id: "call-fixture", output: JSON.stringify(result) }]);
    expect(first.continuation).toEqual({ input: [...initialInput, ...output] });
    for (const { body } of fake.requests) {
      expect(body.store).toBe(false);
      expect(body.include).toEqual(["reasoning.encrypted_content"]);
      expect(body).not.toHaveProperty("previous_response_id");
      expect(body.tools).toEqual([{ type: "function", ...tools[0], strict: true }]);
    }
  });

  it("uses the configured Planner override without changing the Worker model", async () => {
    const fake = transport([[message(plan)], [message(command)]]);
    const llmConfig = resolveLlmConfig({ maxRetries: 0 }, { env: { OPENROUTER_API_KEY: "router-fixture",
      SHELLGEIAI_PLANNER_MODEL: "planner-model" } });
    const runtime = createSolveRuntime({ llmConfig, llm: { fetchImpl: fake.fetchImpl } });
    await runtime.plannerProvider.buildPlan(session);
    await runtime.engine.generateCommand(context);
    expect(fake.requests.map(({ body }) => body.model)).toEqual(["planner-model", "openai/gpt-6.1-sol"]);
  });

  it("preserves an explicit model and prefers the generic key at the OpenAI endpoint", async () => {
    const fake = transport([[message(plan)], [message(command)]]);
    const llmConfig = resolveLlmConfig({ maxRetries: 0 }, { env: {
      LLM_BASE_URL: "https://api.openai.com/v1", OPENAI_API_KEY: "unused-provider-key",
      SHELLGEIAI_LLM_API_KEY: "explicit-fixture", SHELLGEIAI_LLM_MODEL: "openai/custom-model"
    } });
    const runtime = createSolveRuntime({ engine: "openai", llmConfig, llm: { fetchImpl: fake.fetchImpl } });
    await runtime.plannerProvider.buildPlan(session);
    await runtime.engine.generateCommand(context);
    for (const request of fake.requests) {
      expect(request.url).toBe("https://api.openai.com/v1/responses");
      expect(request.headers.authorization).toBe("Bearer explicit-fixture");
      expect(request.body.model).toBe("openai/custom-model");
    }
  });

  it("rejects invalid Planner structured output through SDK parsing", async () => {
    const fake = transport([[message({ variants: [] })]]);
    const llmConfig = resolveLlmConfig({ maxRetries: 0 }, { env: { OPENROUTER_API_KEY: "router-fixture" } });
    const runtime = createSolveRuntime({ llmConfig, llm: { fetchImpl: fake.fetchImpl } });
    await expect(runtime.plannerProvider.buildPlan(session)).rejects.toThrow("invalid structured output");
    expect(fake.requests).toHaveLength(1);
  });
});
