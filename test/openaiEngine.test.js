import { describe, expect, it, vi } from "vitest";
import { OpenAIEngine, __testUtils } from "../src/engines/openaiEngine.js";

describe("OpenAIEngine", () => {
  it("builds a response request and parses JSON output", async () => {
    const create = vi.fn(async () => ({
      output_text: '{"command":"printf \\"123\\\\n\\"","explanation":"Print a known value."}'
    }));
    const engine = new OpenAIEngine({
      apiKey: "test-key",
      model: "gpt-test",
      client: {
        responses: {
          create
        }
      }
    });

    const result = await engine.generateCommand({
      problem: "print 123",
      attempts: [
        {
          command: "printf '0\\n'",
          passed: false,
          failureReason: "wrong output"
        }
      ],
      workdir: "/tmp/workdir",
      workerId: "worker-2",
      strategy: "awk-first"
    });

    expect(result).toEqual({
      command: 'printf "123\\n"',
      explanation: "Print a known value."
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-test"
    });
    expect(JSON.stringify(create.mock.calls[0][0].input)).toContain("worker-2");
    expect(JSON.stringify(create.mock.calls[0][0].input)).toContain("wrong output");
  });

  it("fails with a clear message when the API key is missing", async () => {
    const engine = new OpenAIEngine({
      apiKey: ""
    });

    await expect(
      engine.generateCommand({
        problem: "print 123",
        attempts: [],
        workdir: "/tmp/workdir"
      })
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
      client: {
        responses: {
          create
        }
      }
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

  it("passes resolved client options to the client factory and reuses the client", async () => {
    const responses = {
      create: vi.fn(async () => ({
        output_text: '{"command":"printf \\"ok\\\\n\\"","explanation":"ok"}'
      }))
    };
    const clientFactory = vi.fn(async (options) => ({
      responses
    }));
    const engine = new OpenAIEngine({
      apiKey: "test-key",
      baseURL: "https://example.invalid/v1",
      timeoutMs: "2500",
      maxRetries: "4",
      clientFactory
    });

    await engine.generateCommand({
      problem: "print ok",
      attempts: [],
      workdir: "/tmp/workdir"
    });
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

  it("resolves retry-related client options from environment-style values with safe fallbacks", async () => {
    const responses = {
      create: vi.fn(async () => ({
        output_text: '{"command":"printf \\"ok\\\\n\\"","explanation":"ok"}'
      }))
    };
    const clientFactory = vi.fn(async (options) => ({
      responses
    }));
    const engine = new OpenAIEngine({
      apiKey: "test-key",
      timeoutMs: "invalid",
      maxRetries: "0",
      clientFactory
    });

    await engine.generateCommand({
      problem: "print ok",
      attempts: [],
      workdir: "/tmp/workdir"
    });

    expect(clientFactory).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: undefined,
      timeoutMs: 15_000,
      maxRetries: 2
    });
  });

  it("reuses an in-flight client factory promise across concurrent calls", async () => {
    let resolveClient;
    const responses = {
      create: vi.fn(async () => ({
        output_text: '{"command":"printf \\"ok\\\\n\\"","explanation":"ok"}'
      }))
    };
    const clientFactory = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveClient = () =>
            resolve({
              responses
            });
        })
    );
    const engine = new OpenAIEngine({
      apiKey: "test-key",
      clientFactory
    });

    const firstCall = engine.generateCommand({
      problem: "print ok",
      attempts: [],
      workdir: "/tmp/workdir"
    });
    const secondCall = engine.generateCommand({
      problem: "print ok again",
      attempts: [],
      workdir: "/tmp/workdir"
    });

    expect(clientFactory).toHaveBeenCalledTimes(1);

    resolveClient();

    await expect(Promise.all([firstCall, secondCall])).resolves.toEqual([
      {
        command: 'printf "ok\\n"',
        explanation: "ok"
      },
      {
        command: 'printf "ok\\n"',
        explanation: "ok"
      }
    ]);
    expect(responses.create).toHaveBeenCalledTimes(2);
  });
});

describe("openaiEngine test utils", () => {
  it("builds different prompts for different strategy contexts", () => {
    const { buildUserPrompt } = __testUtils();

    const awkPrompt = buildUserPrompt({
      problem: "print 123",
      attempts: [
        {
          command: "printf '0\\n'",
          passed: false,
          failureReason: "wrong output"
        }
      ],
      workdir: "/tmp/workdir",
      workerId: "worker-1",
      strategy: "awk-first"
    });
    const sortPrompt = buildUserPrompt({
      problem: "print 123",
      attempts: [
        {
          command: "printf '0\\n'",
          passed: false,
          failureReason: "wrong output"
        }
      ],
      workdir: "/tmp/workdir",
      workerId: "worker-1",
      strategy: "sort-first"
    });

    expect(awkPrompt).toContain("Strategy: awk-first");
    expect(sortPrompt).toContain("Strategy: sort-first");
    expect(awkPrompt).not.toEqual(sortPrompt);
    expect(awkPrompt).toContain("Worker: worker-1");
    expect(awkPrompt).toContain('"reason":"wrong output"');
    expect(awkPrompt).toContain('"passed":false');
  });

  it("omits optional strategy and worker lines when not provided", () => {
    const { buildUserPrompt } = __testUtils();
    const prompt = buildUserPrompt({
      problem: "print 123",
      attempts: [],
      workdir: "/tmp/workdir"
    });

    expect(prompt).toContain("Problem: print 123");
    expect(prompt).toContain("Working directory: /tmp/workdir");
    expect(prompt).toContain("Previous attempts: []");
    expect(prompt).not.toContain("Strategy:");
    expect(prompt).not.toContain("Worker:");
  });

  it("extracts JSON from fenced responses", () => {
    const { parseEngineResponse } = __testUtils();
    expect(parseEngineResponse('```json\n{"command":"printf \\"ok\\\\n\\""}\n```')).toEqual({
      command: 'printf "ok\\n"',
      explanation: "Generated by OpenAI API."
    });
  });

  it("throws for non-JSON responses", () => {
    const { parseEngineResponse } = __testUtils();
    expect(() => parseEngineResponse("not json")).toThrow("The OpenAI engine returned a non-JSON response.");
  });
});
