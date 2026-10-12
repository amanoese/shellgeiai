import { afterEach, describe, expect, it, vi } from "vitest";

const options = {
  apiKey: "test-router-key",
  baseURL: "https://openrouter.ai/api/v1",
  timeoutMs: 30000,
  maxRetries: 0
};
const request = { model: "openai/gpt-6.1-sol", store: false, input: "private problem" };
const success = () => new Response(JSON.stringify({ id: "resp-1", status: "completed", output: [] }), {
  headers: { "content-type": "application/json" }
});

afterEach(() => vi.unstubAllEnvs());

describe("shared LLM client", () => {
  it.each([undefined, "", "   ", null, 123, {}])("rejects an invalid explicit key even with ambient OpenAI credentials", async (apiKey) => {
    const { createLlmClient } = await import("../dist/providers/llm.js");
    vi.stubEnv("OPENAI_API_KEY", "ambient-private-key");
    const fetchImpl = vi.fn(async () => success());
    await expect(createLlmClient({ ...options, apiKey, fetchImpl }))
      .rejects.toThrow("The LLM client requires an explicit non-empty apiKey.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([-1, 6, 1.5, undefined, "2"])("rejects invalid client retry budgets", async (maxRetries) => {
    const { createLlmClient } = await import("../dist/providers/llm.js");
    await expect(createLlmClient({ ...options, maxRetries }))
      .rejects.toThrow("maxRetries must be an integer from 0 to 5 for the LLM client.");
  });

  it.each([undefined, "", "not-a-url", "http://remote.invalid/v1", "https://user:secret@example.invalid/v1",
    "https://example.invalid/v1?key=secret", "https://example.invalid/v1#secret"])("rejects invalid explicit client endpoints safely", async (baseURL) => {
    const { createLlmClient } = await import("../dist/providers/llm.js");
    const error = await createLlmClient({ ...options, baseURL }).catch((value) => value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/baseURL/);
    expect(error.message).not.toContain("secret");
    expect(error.cause).toBeUndefined();
  });

  it("uses the configured endpoint and credentials and disables SDK logging", async () => {
    const { createLlmClient, requestLlmResponse } = await import("../dist/providers/llm.js");
    vi.stubEnv("OPENAI_LOG", "debug");
    vi.stubEnv("OPENAI_ORG_ID", "private-org");
    vi.stubEnv("OPENAI_PROJECT_ID", "private-project");
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", "Authorization: Bearer wrong-key\nX-Secret: private-secret\nX-Stainless-Secret: private-secret\nContent-Type: private-secret");
    const fetchImpl = vi.fn(async () => success());
    const client = await createLlmClient({ ...options, fetchImpl });
    await requestLlmResponse(client, request);
    expect(client.logLevel).toBe("off");
    expect(client.timeout).toBe(30000);
    expect(client.maxRetries).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/responses");
    expect(init.redirect).toBe("error");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-router-key");
    expect(headers.has("openai-organization")).toBe(false);
    expect(headers.has("openai-project")).toBe(false);
    expect(headers.has("x-secret")).toBe(false);
    expect(headers.has("x-stainless-secret")).toBe(false);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it("supports the explicitly configured OpenAI endpoint", async () => {
    const { createLlmClient, requestLlmResponse } = await import("../dist/providers/llm.js");
    const fetchImpl = vi.fn(async () => success());
    const client = await createLlmClient({ ...options, baseURL: "https://api.openai.com/v1", fetchImpl });
    await requestLlmResponse(client, { ...request, model: "gpt-6.1-sol" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
  });

  it.each([400, 401, 402, 403, 404, 429, 500, 503])("sanitizes HTTP %s failures without a fallback request", async (status) => {
    const { createLlmClient, requestLlmResponse } = await import("../dist/providers/llm.js");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: {
      message: "private problem test-router-key https://secret.invalid", type: "private-type"
    } }), { status, headers: { "content-type": "application/json", "x-secret": "private-header" } }));
    const client = await createLlmClient({ ...options, fetchImpl });
    const error = await requestLlmResponse(client, request).catch((value) => value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain(String(status));
    expect(error.message).not.toMatch(/private|test-router-key|secret/);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error)).not.toContain("headers");
    expect(Object.keys(error)).not.toContain("error");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (status === 404) expect(error.message).toMatch(/Responses API.*model/i);
  });

  it("allows only SDK retries for retryable HTTP failures", async () => {
    const { createLlmClient, requestLlmResponse } = await import("../dist/providers/llm.js");
    const fetchImpl = vi.fn(async () => new Response("{}", {
      status: 503, headers: { "content-type": "application/json", "retry-after-ms": "1" }
    }));
    const client = await createLlmClient({ ...options, maxRetries: 2, fetchImpl });
    await expect(requestLlmResponse(client, request)).rejects.toThrow("503");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("never follows a redirect to another destination", async () => {
    const { createLlmClient, requestLlmResponse } = await import("../dist/providers/llm.js");
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: "https://secret.invalid/responses" }
    }));
    const client = await createLlmClient({ ...options, fetchImpl });
    await expect(requestLlmResponse(client, request)).rejects.toThrow("302");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
  });

  it("passes cancellation through the SDK request options", async () => {
    const { requestLlmResponse } = await import("../dist/providers/llm.js");
    const signal = new AbortController().signal;
    const create = vi.fn(async () => ({ status: "completed" }));
    await requestLlmResponse({ responses: { create } }, request, { signal });
    expect(create).toHaveBeenCalledWith(request, { signal });
  });

  it("rejects attempts to change the configured destination without making a fetch", async () => {
    const { createLlmClient, requestLlmResponse } = await import("../dist/providers/llm.js");
    const fetchImpl = vi.fn(async () => success());
    const client = await createLlmClient({ ...options, fetchImpl });
    await expect(requestLlmResponse(client.withOptions({ baseURL: "https://else.invalid/v1" }), request))
      .rejects.toThrow("The LLM API request failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sanitizes connection failures including their nested causes", async () => {
    const { createLlmClient, requestLlmResponse } = await import("../dist/providers/llm.js");
    const fetchImpl = vi.fn(async () => { throw new Error("private key and prompt", {
      cause: new Error("private request headers")
    }); });
    const client = await createLlmClient({ ...options, fetchImpl });
    const error = await requestLlmResponse(client, request).catch((value) => value);
    expect(error.message).toBe("The LLM API request failed. Check the endpoint and connection.");
    expect(error.cause).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps cancellation identifiable without exposing SDK request details", async () => {
    const { createLlmClient, requestLlmResponse } = await import("../dist/providers/llm.js");
    const fetchImpl = vi.fn(async () => success());
    const client = await createLlmClient({ ...options, fetchImpl });
    const controller = new AbortController();
    controller.abort();
    const error = await requestLlmResponse(client, request, { signal: controller.signal }).catch((value) => value);
    expect(error.name).toBe("AbortError");
    expect(error.message).toBe("The LLM API request was cancelled.");
    expect(error.cause).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects timeout values that overflow the Node timer", async () => {
    const { createLlmClient } = await import("../dist/providers/llm.js");
    await expect(createLlmClient({ ...options, timeoutMs: 2147483648 })).rejects.toThrow(/timeoutMs.*2147483647/);
  });
});


describe("safeLlmError structural transport errors", () => {
  it.each([
    ["APIUserAbortError", "The LLM API request was cancelled."],
    ["APIConnectionTimeoutError", "The LLM API request timed out."]
  ])("preserves %s classification for injected error objects", async (name, message) => {
    const { safeLlmError } = await import("../dist/providers/llm.js");
    const error = safeLlmError({ constructor: { name }, message: "private transport body" });
    expect(error.message).toBe(message);
    expect(error.cause).toBeUndefined();
  });
});
