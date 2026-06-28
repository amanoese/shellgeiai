import { describe, expect, it, vi } from "vitest";
import { createRuriEmbedder, meanPool } from "../src/knowledge/ruriEmbedder.js";

describe("Ruri embedder", () => {
  it("mean-pools token embeddings", () => {
    expect(meanPool([[1, 3], [3, 5]])).toEqual([2, 4]);
  });

  it("uses transformers feature extraction pipeline", async () => {
    const pipe = vi.fn(async () => ({
      tolist: () => [[[1, 0], [1, 0]]]
    }));
    const pipeline = vi.fn(async () => pipe);

    const embedder = createRuriEmbedder({ pipeline, model: "cl-nagoya/ruri-v3-30m" });
    await expect(embedder.embed("検索クエリ: CSV")).resolves.toEqual([1, 0]);
    expect(pipeline).toHaveBeenCalledWith("feature-extraction", "cl-nagoya/ruri-v3-30m");
    expect(pipe).toHaveBeenCalledWith("検索クエリ: CSV");
  });
});
