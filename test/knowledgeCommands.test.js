import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildKnowledgeVectors, prepareKnowledgeModel } from "../src/knowledge/commands.js";
import { loadKnowledgeVectorFile } from "../src/knowledge/vectorFile.js";

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-knowledge-"));
}

describe("knowledge commands", () => {
  it("prepares the model by running a warmup embedding", async () => {
    const embedder = { embed: vi.fn(async () => [1, 0]) };

    await expect(prepareKnowledgeModel({ embedder })).resolves.toEqual({
      model: "Xenova/multilingual-e5-small",
      warmedUp: true
    });

    expect(embedder.embed).toHaveBeenCalledWith("検索クエリ: warmup");
  });

  it("builds a vector file from a JSONL dataset", async () => {
    const dir = await createTempDir();
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.json");
    await fs.writeFile(
      datasetPath,
      [
        JSON.stringify({
          id: "man:awk:-F",
          kind: "option",
          command: "awk",
          option: "-F",
          text: "awk -F: CSV columns",
          source: "test"
        }),
        JSON.stringify({
          id: "pattern:count",
          kind: "pattern",
          command: "sort|uniq",
          option: "-c",
          text: "sort | uniq -c counts frequency",
          source: "test"
        })
      ].join("\n"),
      "utf8"
    );
    const embedder = {
      embed: vi.fn(async (text) => (text.includes("awk") ? [1, 0] : [0, 1]))
    };

    await expect(
      buildKnowledgeVectors({
        datasetPath,
        vectorsPath,
        embedder,
        model: "test-model",
        now: () => "2026-06-29T00:00:00.000Z"
      })
    ).resolves.toEqual({
      datasetPath,
      itemCount: 2,
      model: "test-model",
      vectorsPath
    });

    expect(embedder.embed).toHaveBeenCalledWith("検索クエリ: warmup");
    expect(embedder.embed).toHaveBeenCalledWith("検索文書: awk -F: CSV columns");
    expect(embedder.embed).toHaveBeenCalledWith("検索文書: sort | uniq -c counts frequency");
    await expect(loadKnowledgeVectorFile(vectorsPath)).resolves.toMatchObject({
      version: 1,
      model: "test-model",
      dataset: datasetPath,
      createdAt: "2026-06-29T00:00:00.000Z",
      items: [
        { id: "man:awk:-F", vector: [1, 0] },
        { id: "pattern:count", vector: [0, 1] }
      ]
    });
  });
});
