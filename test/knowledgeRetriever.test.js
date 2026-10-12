import { describe, expect, it, vi } from "vitest";
import { createKnowledgeRetriever } from "../dist/knowledge/retriever.js";
import { formatEmbeddingQuery } from "../dist/knowledge/embeddingInputs.js";

function fixture(embedder = { embed: vi.fn(async () => [1, 0]) }, signal) {
  const records = [{ id: "awk", command: "awk", option: "-F", text: "x".repeat(1000), source: "seed" }];
  const store = { search: vi.fn(() => records) };
  return { store, embedder, retriever: createKnowledgeRetriever({ store, generationId: 7, embedder, signal }) };
}
describe("persisted retrieval", () => {
  it("formats planner input and pins a generation with broad diversity", async () => {
    const { store, embedder, retriever } = fixture();
    const hints = await retriever.retrieveForPlanner({ problem: "集計", expectedOutput: "頻度" });
    expect(embedder.embed.mock.calls[0][0]).toBe(formatEmbeddingQuery("集計\n期待する出力: 頻度"));
    expect(store.search).toHaveBeenCalledWith({ generationId: 7, vector: [1, 0], topK: 5, maxPerCommand: 1 });
    expect(hints[0].text.length).toBeLessThan(1000);
    expect(hints[0]).not.toHaveProperty("score");
  });
  it("uses worker diversity and shares concurrent identical query embeddings", async () => {
    const { store, embedder, retriever } = fixture();
    await Promise.all([retriever.search({ query: "CSV" }), retriever.search({ query: "CSV" })]);
    expect(embedder.embed).toHaveBeenCalledOnce();
    expect(store.search).toHaveBeenCalledWith({ generationId: 7, vector: [1, 0], topK: 5, maxPerCommand: 2 });
    await retriever.retrieveForPlanner({ problem: "CSV" });
    expect(embedder.embed).toHaveBeenCalledOnce();
    expect(store.search.mock.calls.at(-1)[0].maxPerCommand).toBe(1);
  });
  it("evicts failed embeddings so an identical query can retry", async () => {
    const { retriever, embedder } = fixture({ embed: vi.fn().mockRejectedValueOnce(new Error("API failed")).mockResolvedValueOnce([1, 0]) });
    await expect(retriever.search({ query: "CSV" })).rejects.toThrow("API failed");
    await expect(retriever.search({ query: "CSV" })).resolves.toHaveLength(1);
    expect(embedder.embed).toHaveBeenCalledTimes(2);
  });
  it("rejects blank queries before API", async () => {
    const { retriever, embedder } = fixture();
    await expect(retriever.search({ query: " " })).rejects.toThrow("query");
    expect(embedder.embed).not.toHaveBeenCalled();
  });
  it.each([{ topK: 0 }, { topK: -1 }, { maxPerCommand: 0 }])("returns empty results for nonpositive limits without API", async limits => {
    const { retriever, embedder, store } = fixture();
    await expect(retriever.searchRecords({ query: "CSV", ...limits })).resolves.toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(store.search).not.toHaveBeenCalled();
  });
  it.each([{ topK: 1.5 }, { maxPerCommand: NaN }])("rejects invalid limits before API", async limits => {
    const { retriever, embedder } = fixture();
    await expect(retriever.searchRecords({ query: "CSV", ...limits })).rejects.toThrow("integers");
    expect(embedder.embed).not.toHaveBeenCalled();
  });
  it("rejects cancellation promptly even if an injected embedder ignores its signal", async () => {
    const controller = new AbortController();
    let resolve;
    const embedder = { embed: vi.fn(() => new Promise(done => { resolve = done; })) };
    const { store, retriever } = fixture(embedder, controller.signal);
    const promise = retriever.search({ query: "CSV" });
    controller.abort(new Error("deadline exceeded"));
    await expect(promise).rejects.toThrow("deadline exceeded");
    resolve([1, 0]);
    await Promise.resolve();
    expect(store.search).not.toHaveBeenCalled();
  });
});
