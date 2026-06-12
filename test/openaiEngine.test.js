import { describe, expect, it, vi } from "vitest";
import { OpenAIEngine, __testUtils } from "../src/engines/openaiEngine.js";

describe("OpenAIEngine", () => {
  it("builds response request and parses JSON output", async () => {
    const create = vi.fn(async () => ({
      output_text: '{"command":"printf \\"123\\\\n\\"","explanation":"Print a known value."}'
    }));
    const engine = new OpenAIEngine({
      apiKey: "test-key",
      model: "gpt-test",
      client: { responses: { create } }
    });

    const result = await engine.generateCommand({
      problem: "print 123",
      attempts: [
        {
          command: "printf '0\\n'",
          passed: false,
          failureReason: "wrong output",
          durationMs: 12
        }
      ],
      workdir: "/tmp/workdir",
      workerId: "worker-2",
      strategy: "awk-first",
      workerTask: {
        workerId: "worker-2",
        strategy: "awk-first",
        strategyProfile: {
          name: "awk-centric",
          focus: "Prefer awk for record-wise transforms.",
          retryHint: "Remove redundant stages before switching tools.",
          rubricFocus: ["conciseness", "shellness", "readability"]
        },
        maxAttempts: 3
      }
    });

    expect(result).toEqual({
      command: 'printf "123\\n"',
      explanation: "Print a known value."
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-test" });
    expect(JSON.stringify(create.mock.calls[0][0].input)).toContain("worker-2");
    expect(JSON.stringify(create.mock.calls[0][0].input)).toContain("wrong output");
    expect(JSON.stringify(create.mock.calls[0][0].input)).toContain("awk-centric");
    expect(JSON.stringify(create.mock.calls[0][0].input)).toContain("Retry budget: 3");
    expect(JSON.stringify(create.mock.calls[0][0].input)).toContain("Shellgei rubric focus:");
  });

  it("fails with a clear message when API key is missing", async () => {
    const engine = new OpenAIEngine({ apiKey: "" });

    await expect(
      engine.generateCommand({ problem: "print 123", attempts: [], workdir: "/tmp/workdir" })
    ).rejects.toThrow("OPENAI_API_KEY is not set. Set it and retry, or use --engine mock.");
  });

  it("extracts text from structured response output blocks", async () => {
    const create = vi.fn(async () => ({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: '{"command":"printf \\"ok\\\\n\\"","explanation":"From structured output."}'
            }
          ]
        }
      ]
    }));
    const engine = new OpenAIEngine({
      apiKey: "test-key",
      client: { responses: { create } }
    });

    const result = await engine.generateCommand({
      problem: "print ok",
      attempts: [],
      workdir: "/tmp/workdir"
    });

    expect(result).toEqual({
      command: 'printf "ok\\n"',
      explanation: "From structured output."
    });
  });

  it("passes resolved client options and reuses the client factory", async () => {
    const responses = {
      create: vi.fn(async () => ({
        output_text: '{"command":"printf \\"ok\\\\n\\"","explanation":"ok"}'
      }))
    };
    const clientFactory = vi.fn(async (options) => ({ responses, options }));
    const engine = new OpenAIEngine({
      apiKey: "test-key",
      baseURL: "https://example.invalid/v1",
      timeoutMs: "2500",
      maxRetries: "4",
      clientFactory
    });

    await engine.generateCommand({ problem: "print ok", attempts: [], workdir: "/tmp/workdir" });
    await engine.generateCommand({
      problem: "print ok again",
      attempts: [],
      workdir: "/tmp/workdir"
    });

    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(clientFactory).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "https://example.invalid/v1",
      timeoutMs: 2500,
      maxRetries: 4
    });
    expect(responses.create).toHaveBeenCalledTimes(2);
  });
});

describe("openaiEngine test utils", () => {
  it("builds rubric-aware prompts for different strategy contexts", () => {
    const { buildUserPrompt } = __testUtils();
    const prompt = buildUserPrompt({
      problem: "sum third column",
      attempts: [],
      workdir: "/tmp/workdir",
      workerTask: {
        workerId: "worker-1",
        strategy: "awk-first",
        strategyProfile: {
          name: "awk-centric",
          focus: "Prefer awk for record-wise transforms.",
          retryHint: "Remove redundant stages before switching tools.",
          rubricFocus: ["conciseness", "shellness", "readability"]
        },
        maxAttempts: 3
      }
    });

    expect(prompt).toContain("Shellgei rubric focus:");
    expect(prompt).toContain("awk-centric");
    expect(prompt).toContain("Retry budget: 3");
  });

  it("includes assigned variant guidance in the prompt", () => {
    const { buildUserPrompt } = __testUtils();
    const prompt = buildUserPrompt({
      problem: "1から100までの素数を出力してください",
      attempts: [],
      workdir: "/tmp/workdir",
      workerTask: {
        workerId: "worker-3",
        strategy: "default",
        strategyProfile: {
          name: "balanced-search",
          focus: "Start with direct safe one-liner.",
          retryHint: "Remove redundant stages before changing whole approach.",
          rubricFocus: ["conciseness", "shellness", "robustness"]
        },
        assignedVariant: {
          variantId: "variant-factor",
          label: "factor-first",
          approach: "external-utility",
          toolBias: ["seq", "factor", "awk"],
          intent: "Check whether external utilities collapse the primality test cleanly.",
          constraints: ["Prefer concise one-liners"],
          avoid: ["awk-only contortions"],
          explorationHint: "Consider seq + factor before custom primality logic."
        },
        maxAttempts: 3
      }
    });

    expect(prompt).toContain("Assigned variant:");
    expect(prompt).toContain("factor-first");
    expect(prompt).toContain("external-utility");
    expect(prompt).toContain("Exploration hint:");
    expect(prompt).toContain("Consider seq + factor before custom primality logic.");
  });

  it("omits optional strategy and worker lines when not provided", () => {
    const { buildUserPrompt } = __testUtils();
    const prompt = buildUserPrompt({
      problem: "print 123",
      attempts: [],
      workdir: "/tmp/workdir"
    });

    expect(prompt).not.toContain("Worker:");
    expect(prompt).not.toContain("Strategy:");
    expect(prompt).not.toContain("Assigned variant:");
  });

  it("extracts JSON fenced responses", () => {
    const { parseEngineResponse } = __testUtils();

    expect(parseEngineResponse('```json\n{"command":"printf \\"ok\\\\n\\""}\n```')).toEqual({
      command: 'printf "ok\\n"',
      explanation: "Generated by OpenAI API."
    });
  });

  it("throws for non-JSON responses", () => {
    const { parseEngineResponse } = __testUtils();

    expect(() => parseEngineResponse("not json")).toThrow(
      "The OpenAI engine returned non-JSON response."
    );
  });
});
