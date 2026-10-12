import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_KNOWLEDGE_MODEL } from "../dist/knowledge/config.js";
import { createOpenRouterEmbedder } from "../dist/providers/embedder.js";

const model = "test/embedding";
const vectorResponse = (vectors = [[1, 2]], responseModel = model) => new Response(JSON.stringify({
  object: "list", model: responseModel,
  data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })), usage: { prompt_tokens: 1, total_tokens: 1 }
}), { status: 200, headers: { "Content-Type": "application/json" } });
const client = (options = {}) => createOpenRouterEmbedder({ model, apiKey: "secret-key", ...options });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("OpenRouter embedder", () => {
  it("posts float embeddings as an array and restores response index order", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ model, data: [
      { index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }
    ] })));
    const embedder = client({ fetchImpl });
    await expect(embedder.embedBatch([" one ", "two"])).resolves.toEqual([[1, 2], [3, 4]]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer secret-key");
    expect(JSON.parse(init.body)).toEqual({ model, input: ["one", "two"], encoding_format: "float" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("embeds one text and checks the default Qwen dimension", async () => {
    const vectors = Array(4096).fill(0); vectors[0] = 1;
    const embedder = createOpenRouterEmbedder({ apiKey: "key", fetchImpl: async () => vectorResponse([vectors], DEFAULT_KNOWLEDGE_MODEL) });
    await expect(embedder.embed("query")).resolves.toEqual(vectors);
    const wrong = createOpenRouterEmbedder({ apiKey: "key", fetchImpl: async () => vectorResponse([[1, 2]], DEFAULT_KNOWLEDGE_MODEL) });
    await expect(wrong.embed("query")).rejects.toThrow(/dimension/i);
  });

  it("accepts the observed Qwen provider response name without changing the requested model", async () => {
    const vector = Array(4096).fill(0); vector[0] = 1;
    const fetchImpl = vi.fn(async () => vectorResponse([vector], "Qwen/Qwen3-Embedding-8B"));
    const embedder = createOpenRouterEmbedder({ apiKey: "key", fetchImpl });
    await expect(embedder.embed("query")).resolves.toEqual(vector);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe("qwen/qwen3-embedding-8b");
  });

  it.each([
    "Qwen/Qwen3-Embedding-4B", "other/qwen3-embedding-8b",
    "Qwen/Qwen3-Embedding-8B:free", "QWEN/QWEN3-EMBEDDING-8B", null
  ])("rejects unrecognized Qwen response names without retrying: %s", async responseModel => {
    const vector = Array(4096).fill(0); vector[0] = 1;
    const fetchImpl = vi.fn(async () => vectorResponse([vector], responseModel));
    const embedder = createOpenRouterEmbedder({ apiKey: "key", fetchImpl });
    await expect(embedder.embed("query")).rejects.toThrow(/model does not match/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not relax model-name case matching for other models", async () => {
    await expect(client({ fetchImpl: async () => vectorResponse([[1, 2]], "Test/Embedding") }).embed("query"))
      .rejects.toThrow(/model does not match/);
  });

  it.each([
    { data: [{ index: 0, embedding: [1, 2] }], expected: /dimension/i },
    { data: [], expected: /item count/i },
    { data: [{ index: 0, embedding: Array(4096).fill(0) }], expected: /norm/i }
  ])("still validates vector integrity for the Qwen response alias %#", async ({ data, expected }) => {
    const embedder = createOpenRouterEmbedder({ apiKey: "key", fetchImpl: async () =>
      new Response(JSON.stringify({ model: "Qwen/Qwen3-Embedding-8B", object: "list", data })) });
    await expect(embedder.embed("query")).rejects.toThrow(expected);
  });

  it("rejects missing credentials and invalid input before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(client({ apiKey: " ", fetchImpl }).embed("query")).rejects.toThrow(/OPENROUTER_API_KEY/);
    for (const texts of [[], [" "], [1], "query"]) {
      await expect(client({ fetchImpl }).embedBatch(texts)).rejects.toThrow(/text|input/i);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { model: "wrong", data: [{ index: 0, embedding: [1, 2] }] },
    { model, data: [] },
    { model, data: [{ index: -1, embedding: [1, 2] }] },
    { model, data: [{ index: 1, embedding: [1, 2] }] },
    { model, data: [{ index: 0.5, embedding: [1, 2] }] },
    { model, data: [{ index: 0, embedding: [] }] },
    { model, data: [{ index: 0, embedding: [0, 0] }] },
    { model, data: [{ index: 0, embedding: [null, 1] }] },
    { model, data: [{ index: 0, embedding: ["1", 1] }] },
    { model, data: [{ index: 0, embedding: [1e40, 1] }] },
    { model, data: [{ index: 0, embedding: [1e-50, 0] }] }
  ])("rejects malformed responses without retrying %#", async (payload) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload)));
    await expect(client({ fetchImpl }).embed("query")).rejects.toThrow(/model|response|vector|dimension/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate indices and unequal batch vector dimensions", async () => {
    for (const data of [
      [{ index: 0, embedding: [1, 2] }, { index: 0, embedding: [3, 4] }],
      [{ index: 0, embedding: [1, 2] }, { index: 1, embedding: [3] }]
    ]) {
      await expect(client({ fetchImpl: async () => new Response(JSON.stringify({ model, data })) }).embedBatch(["one", "two"]))
        .rejects.toThrow(/index|dimension|response/i);
    }
  });

  it("enforces consistent dimensions across later requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(vectorResponse([[1, 2]])).mockResolvedValueOnce(vectorResponse([[1, 2, 3]]));
    const embedder = client({ fetchImpl });
    await embedder.embed("one");
    await expect(embedder.embed("two")).rejects.toThrow(/dimension/i);
  });

  it.each([400, 401, 402, 404])("does not retry status %s or expose response secrets", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("secret-key secret-input secret-body", { status }));
    const error = await client({ fetchImpl }).embed("secret-input").catch((value) => value);
    expect(error.message).toContain(String(status));
    expect(JSON.stringify(error) + error.stack).not.toMatch(/secret-/);
    expect(error.cause).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and 503 with bounded Retry-After and exponential jitter", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "1000" } }))
      .mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(vectorResponse());
    const sleep = vi.fn(async () => {});
    await expect(client({ fetchImpl, sleep, random: () => 0.5 }).embed("query")).resolves.toEqual([1, 2]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([10000, 1125]);
  });

  it("cancels an unread rate-limit response before retrying", async () => {
    const cancel = vi.fn();
    let cancelledBeforeRetry = false;
    const response = new Response(new ReadableStream({ cancel }), { status: 429 });
    const fetchImpl = vi.fn().mockResolvedValueOnce(response).mockImplementationOnce(async () => {
      cancelledBeforeRetry = cancel.mock.calls.length === 1;
      return vectorResponse();
    });
    await expect(client({ fetchImpl, sleep: async () => {} }).embed("query")).resolves.toEqual([1, 2]);
    expect(cancelledBeforeRetry).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("retries transient fetch errors and redacts their messages after exhaustion", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("secret-key secret-input"); });
    const error = await client({ fetchImpl, sleep: async () => {}, maxRetries: 1 }).embed("secret-input").catch((value) => value);
    expect(error.message).toMatch(/network/i);
    expect(error.stack).not.toMatch(/secret-/);
    expect(error.cause).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry arbitrary non-network exceptions", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("secret-error"); });
    await expect(client({ fetchImpl, sleep: async () => {} }).embed("query")).rejects.toThrow(/request/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid JSON immediately without exposing its body", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret-key invalid json"));
    const error = await client({ fetchImpl }).embed("query").catch((value) => value);
    expect(error.message).toMatch(/response/i);
    expect(error.stack).not.toContain("secret-key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient stream failure while reading a successful response", async () => {
    const networkError = new TypeError("secret-key stream interrupted", { cause: { code: "UND_ERR_SOCKET" } });
    const response = new Response(new ReadableStream({
      start(controller) { controller.error(networkError); }
    }));
    const fetchImpl = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(vectorResponse());
    await expect(client({ fetchImpl, sleep: async () => {} }).embed("query")).resolves.toEqual([1, 2]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("redacts stream failures after exhausting retries", async () => {
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError("secret-key secret-input", { cause: { code: "UND_ERR_SOCKET" } })); }
    })));
    const error = await client({ fetchImpl, maxRetries: 1, sleep: async () => {} }).embed("query").catch((value) => value);
    expect(error.message).toMatch(/network/i);
    expect(error.stack).not.toMatch(/secret-/);
    expect(error.cause).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("times out a request without retrying or requiring fetch to settle", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const promise = client({ fetchImpl, timeoutMs: 10 }).embed("query");
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts active requests and never retries external cancellation", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const promise = client({ fetchImpl }).embed("query", { signal: controller.signal });
    controller.abort(new Error("secret-reason"));
    const error = await promise.catch((value) => value);
    expect(error.message).toMatch(/cancel|abort/i);
    expect(error.stack).not.toContain("secret-reason");
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts a backoff even when injected sleep never settles", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    const sleep = vi.fn(() => new Promise(() => {}));
    const promise = client({ fetchImpl, sleep }).embed("query", { signal: controller.signal });
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(promise).rejects.toThrow(/cancel|abort/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects already aborted signals before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(client({ fetchImpl }).embed("query", { signal: AbortSignal.abort() })).rejects.toThrow(/cancel|abort/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads validated timeout and retry settings from the environment", async () => {
    vi.stubEnv("SHELLGEIAI_EMBEDDING_TIMEOUT_MS", "20");
    vi.stubEnv("SHELLGEIAI_EMBEDDING_MAX_RETRIES", "0");
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    await expect(client({ fetchImpl }).embed("query")).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const value of ["0", "-1", "1.5", "abc", "Infinity", ""]) {
      expect(() => client({ timeoutMs: value })).toThrow(/timeout/i);
    }
    for (const value of ["-1", "6", "1.5", "abc", ""]) {
      expect(() => client({ maxRetries: value })).toThrow(/retr/i);
    }
  });
});
