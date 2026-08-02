import { describe, expect, it, vi } from "vitest";
import { createKnowledgeRetriever } from "../src/knowledge/retriever.js";
import { searchKnowledgeRecords } from "../src/knowledge/vectorSearch.js";

const vectors = new Map([
  ["検索クエリ: CSV の 3列目を合計する\nawk-worker", [1, 0]],
  ["検索文書: awk -F: CSV の列を処理する", [1, 0]],
  ["検索文書: sort -k: 指定列で並べ替える", [0, 1]]
]);

const fakeEmbedder = {
  async embed(text) {
    return vectors.get(text) ?? [0, 1];
  }
};

describe("knowledge retrieval", () => {
  it("searches records by cosine similarity", async () => {
    const results = await searchKnowledgeRecords({
      query: "検索クエリ: CSV の 3列目を合計する\nawk-worker",
      records: [
        { id: "awk", command: "awk", text: "awk -F: CSV の列を処理する" },
        { id: "sort", command: "sort", text: "sort -k: 指定列で並べ替える" }
      ],
      embedder: fakeEmbedder,
      topK: 1
    });

    expect(results).toEqual([
      expect.objectContaining({ id: "awk", score: 1 })
    ]);
  });

  it("reuses record embeddings across repeated searches with the same embedder and records", async () => {
    const calls = [];
    const records = [
      { id: "awk", command: "awk", text: "awk -F: CSV の列を処理する" },
      { id: "sort", command: "sort", text: "sort -k: 指定列で並べ替える" }
    ];
    const embedder = {
      async embed(text) {
        calls.push(text);
        return vectors.get(text) ?? [1, 0];
      }
    };

    await searchKnowledgeRecords({
      query: "検索クエリ: CSV の 3列目を合計する\nawk-worker",
      records,
      embedder
    });
    await searchKnowledgeRecords({
      query: "検索クエリ: CSV の 3列目を合計する\nawk-worker",
      records,
      embedder
    });

    expect(calls).toEqual([
      "検索クエリ: CSV の 3列目を合計する\nawk-worker",
      "検索文書: awk -F: CSV の列を処理する",
      "検索文書: sort -k: 指定列で並べ替える",
      "検索クエリ: CSV の 3列目を合計する\nawk-worker"
    ]);
  });

  it("limits selected records per command", async () => {
    const results = await searchKnowledgeRecords({
      query: "query",
      records: [
        { id: "awk-1", command: "awk", text: "awk one" },
        { id: "awk-2", command: "awk", text: "awk two" },
        { id: "sort-1", command: "sort", text: "sort one" }
      ],
      embedder: {
        async embed() {
          return [1, 0];
        }
      },
      topK: 3,
      maxPerCommand: 1
    });

    expect(results.map((record) => record.id)).toEqual(["awk-1", "sort-1"]);
  });

  it("returns empty results for empty records", async () => {
    await expect(searchKnowledgeRecords({
      query: "query",
      records: [],
      embedder: fakeEmbedder
    })).resolves.toEqual([]);
  });

  it("returns empty results for topK zero without embedding records", async () => {
    const calls = [];
    const results = await searchKnowledgeRecords({
      query: "query",
      records: [
        { id: "awk", command: "awk", text: "awk text" }
      ],
      embedder: {
        async embed(text) {
          calls.push(text);
          return [1, 0];
        }
      },
      topK: 0
    });

    expect(results).toEqual([]);
    expect(calls).toEqual(["query"]);
  });

  it("scores zero vectors as zero similarity", async () => {
    const results = await searchKnowledgeRecords({
      query: "query",
      records: [
        { id: "zero", command: "awk", text: "zero vector" }
      ],
      embedder: {
        async embed() {
          return [0, 0];
        }
      },
      topK: 1
    });

    expect(results).toEqual([
      expect.objectContaining({ id: "zero", score: 0 })
    ]);
  });

  it("rejects embedding vectors with different dimensions", async () => {
    await expect(searchKnowledgeRecords({
      query: "query",
      records: [
        { id: "awk", command: "awk", text: "awk text" }
      ],
      embedder: {
        async embed(text) {
          return text === "query" ? [1, 0] : [1, 0, 0];
        }
      }
    })).rejects.toThrow("Cannot compare embedding vectors with different dimensions.");
  });

  it("retrieves broad planner hints with at most one result per command", async () => {
    const calls = [];
    const retriever = createKnowledgeRetriever({
      records: [
        { id: "awk-1", command: "awk", option: "-F", text: "awk one", source: "seed", vector: [1, 0] },
        { id: "awk-2", command: "awk", option: "-v", text: "awk two", source: "seed", vector: [1, 0] },
        { id: "sort-1", command: "sort", option: "-k", text: "sort one", source: "seed", vector: [1, 0] },
        { id: "uniq-1", command: "uniq", option: "-c", text: "uniq one", source: "seed", vector: [1, 0] },
        { id: "cut-1", command: "cut", option: "-d", text: "cut one", source: "seed", vector: [1, 0] },
        { id: "sed-1", command: "sed", option: "-n", text: "sed one", source: "seed", vector: [1, 0] }
      ],
      embedder: {
        async embed(text) {
          calls.push(text);
          return [1, 0];
        }
      }
    });

    const hints = await retriever.retrieveForPlanner({
      problem: "値を集計する",
      expectedOutput: "頻度順の一覧"
    });

    expect(hints.map((record) => record.id)).toEqual([
      "awk-1",
      "sort-1",
      "uniq-1",
      "cut-1",
      "sed-1"
    ]);
    expect(hints[0]).toEqual({
      id: "awk-1",
      command: "awk",
      option: "-F",
      text: "awk one",
      source: "seed"
    });
    expect(calls).toEqual(["検索クエリ: 値を集計する\n期待する出力: 頻度順の一覧"]);
  });

  it("returns at most five generic search results and two per command", async () => {
    const calls = [];
    const retriever = createKnowledgeRetriever({
      records: [
        { id: "awk-1", command: "awk", text: "awk one", vector: [1, 0] },
        { id: "awk-2", command: "awk", text: "awk two", vector: [1, 0] },
        { id: "awk-3", command: "awk", text: "awk three", vector: [1, 0] },
        { id: "sort-1", command: "sort", text: "sort one", vector: [1, 0] },
        { id: "uniq-1", command: "uniq", text: "uniq one", vector: [1, 0] },
        { id: "cut-1", command: "cut", text: "cut one", vector: [1, 0] },
        { id: "sed-1", command: "sed", text: "sed one", vector: [1, 0] }
      ],
      embedder: {
        async embed(text) {
          calls.push(text);
          return [1, 0];
        }
      }
    });

    const results = await retriever.search({ query: "集計" });

    expect(results.map((record) => record.id)).toEqual([
      "awk-1",
      "awk-2",
      "sort-1",
      "uniq-1",
      "cut-1"
    ]);
    expect(calls).toEqual(["検索クエリ: 集計"]);
  });

  it("uses precomputed record vectors without embedding documents", async () => {
    const embedder = {
      embed: vi.fn(async (text) => {
        if (text.startsWith("検索文書:")) {
          throw new Error("document embedding should not run");
        }
        return [1, 0];
      })
    };

    const results = await searchKnowledgeRecords({
      query: "検索クエリ: CSV",
      records: [
        { id: "awk", command: "awk", text: "awk -F: CSV の列を処理する", vector: [1, 0] },
        { id: "sort", command: "sort", text: "sort -k: 指定列で並べ替える", vector: [0, 1] }
      ],
      embedder,
      topK: 1
    });

    expect(results).toEqual([expect.objectContaining({ id: "awk", score: 1 })]);
    expect(embedder.embed).toHaveBeenCalledTimes(1);
    expect(embedder.embed).toHaveBeenCalledWith("検索クエリ: CSV");
  });
});
