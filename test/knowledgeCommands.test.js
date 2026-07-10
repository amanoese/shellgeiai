import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KNOWLEDGE_VECTORS,
  buildKnowledgeVectors,
  prepareKnowledgeModel,
  searchKnowledge
} from "../src/knowledge/commands.js";
import { loadKnowledgeVectorFile } from "../src/knowledge/vectorFile.js";

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-knowledge-"));
}

describe("knowledge commands", () => {
  it("prepares the model by running a warmup embedding", async () => {
    const embedder = { embed: vi.fn(async () => [1, 0]) };

    await expect(prepareKnowledgeModel({ embedder })).resolves.toEqual({
      model: "sirasagi62/ruri-v3-30m-ONNX",
      warmedUp: true
    });

    expect(embedder.embed).toHaveBeenCalledWith("検索クエリ: warmup");
  });

  it("builds a vector file from a JSONL dataset", async () => {
    const dir = await createTempDir();
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
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
    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe(
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 2,
          model: "test-model",
          dataset: datasetPath,
          createdAt: "2026-06-29T00:00:00.000Z"
        }),
        JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
        JSON.stringify({ type: "item", id: "pattern:count", vector: [0, 1] }),
        ""
      ].join("\n")
    );
    await expect(loadKnowledgeVectorFile(vectorsPath)).resolves.toMatchObject({
      version: 2,
      itemCount: 2,
      model: "test-model",
      dataset: datasetPath,
      createdAt: "2026-06-29T00:00:00.000Z",
      items: [
        { id: "man:awk:-F", vector: [1, 0] },
        { id: "pattern:count", vector: [0, 1] }
      ]
    });
  });

  it("uses stable default vector file path", async () => {
    const dir = await createTempDir();
    const datasetPath = path.join(dir, "knowledge.jsonl");
    await fs.writeFile(
      datasetPath,
      `${JSON.stringify({
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: "awk -F: CSV columns",
        source: "test"
      })}\n`,
      "utf8"
    );
    const embedder = { embed: vi.fn(async () => [1, 0]) };

    await expect(
      buildKnowledgeVectors({
        datasetPath,
        embedder,
        model: "owner/custom-model",
        now: () => "2026-06-29T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      vectorsPath: path.join(dir, "knowledge.vectors.jsonl")
    });
  });

  it("commits the incremental vector writer after a successful build", async () => {
    const dir = await createTempDir();
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      datasetPath,
      `${JSON.stringify({
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: "awk -F: CSV columns",
        source: "test"
      })}\n`,
      "utf8"
    );
    const writer = {
      writeItem: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      abort: vi.fn(async () => {})
    };
    const openVectorWriter = vi.fn(async () => writer);
    const embedder = { embed: vi.fn(async () => [1, 0]) };

    await buildKnowledgeVectors({
      datasetPath,
      vectorsPath,
      embedder,
      model: "test-model",
      now: () => "2026-06-29T00:00:00.000Z",
      openVectorWriter
    });

    expect(openVectorWriter).toHaveBeenCalledWith(vectorsPath, {
      version: 2,
      itemCount: 1,
      model: "test-model",
      dataset: datasetPath,
      createdAt: "2026-06-29T00:00:00.000Z"
    });
    expect(writer.commit).toHaveBeenCalledOnce();
    expect(writer.abort).not.toHaveBeenCalled();
  });

  it("aborts the incremental vector writer when a build fails", async () => {
    const dir = await createTempDir();
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      datasetPath,
      `${JSON.stringify({
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: "awk -F: CSV columns",
        source: "test"
      })}\n`,
      "utf8"
    );
    const writer = {
      writeItem: vi.fn(async () => {
        throw new Error("vector write failed");
      }),
      commit: vi.fn(async () => {}),
      abort: vi.fn(async () => {})
    };
    const openVectorWriter = vi.fn(async () => writer);
    const embedder = { embed: vi.fn(async () => [1, 0]) };

    await expect(
      buildKnowledgeVectors({
        datasetPath,
        vectorsPath,
        embedder,
        model: "test-model",
        now: () => "2026-06-29T00:00:00.000Z",
        openVectorWriter
      })
    ).rejects.toThrow("vector write failed");

    expect(openVectorWriter).toHaveBeenCalledWith(vectorsPath, {
      version: 2,
      itemCount: 1,
      model: "test-model",
      dataset: datasetPath,
      createdAt: "2026-06-29T00:00:00.000Z"
    });
    expect(writer.commit).not.toHaveBeenCalled();
    expect(writer.abort).toHaveBeenCalledOnce();
  });

  it("preserves an existing vector file when embedding fails", async () => {
    const dir = await createTempDir();
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      datasetPath,
      `${JSON.stringify({
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: "awk -F: CSV columns",
        source: "test"
      })}\n`,
      "utf8"
    );
    await fs.writeFile(vectorsPath, "existing-cache\n", "utf8");
    const embedder = {
      embed: vi.fn(async (text) => {
        if (text.startsWith("検索文書:")) throw new Error("embedding failed");
        return [1, 0];
      })
    };

    await expect(
      buildKnowledgeVectors({ datasetPath, vectorsPath, embedder, model: "test-model" })
    ).rejects.toThrow("embedding failed");

    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe("existing-cache\n");
    expect(await fs.readdir(dir)).toEqual(["knowledge.jsonl", "knowledge.vectors.jsonl"]);
  });

  it("searches knowledge records using precomputed vectors", async () => {
    const dir = await createTempDir();
    const datasetPath = path.join(dir, "knowledge.jsonl");
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
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
    await fs.writeFile(
      vectorsPath,
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 2,
          model: "test-model",
          dataset: datasetPath,
          createdAt: "2026-06-29T00:00:00.000Z"
        }),
        JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
        JSON.stringify({ type: "item", id: "pattern:count", vector: [0, 1] }),
        ""
      ].join("\n"),
      "utf8"
    );

    const embedder = { embed: vi.fn(async () => [0, 1]) };

    await expect(
      searchKnowledge({
        query: "件数を数える",
        datasetPath,
        vectorsPath,
        embedder,
        model: "test-model",
        topK: 1
      })
    ).resolves.toEqual({
      datasetPath,
      model: "test-model",
      query: "件数を数える",
      results: [
        expect.objectContaining({
          id: "pattern:count",
          score: 1
        })
      ],
      vectorsPath
    });
    expect(embedder.embed).toHaveBeenCalledWith("検索クエリ: 件数を数える");
    expect(embedder.embed).not.toHaveBeenCalledWith(expect.stringContaining("検索文書:"));
  });

  it("searches the packaged default cache without embedding records", async () => {
    const vectorFile = await loadKnowledgeVectorFile(DEFAULT_KNOWLEDGE_VECTORS);
    const embedder = { embed: vi.fn(async () => vectorFile.items[0].vector) };

    await expect(
      searchKnowledge({ query: "CSV の列を処理", embedder, topK: 1 })
    ).resolves.toMatchObject({ vectorsPath: DEFAULT_KNOWLEDGE_VECTORS });
    expect(embedder.embed).toHaveBeenCalledWith("検索クエリ: CSV の列を処理");
    expect(embedder.embed).not.toHaveBeenCalledWith(expect.stringContaining("検索文書:"));
  });
});
