import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_KNOWLEDGE_DATASET,
  DEFAULT_KNOWLEDGE_VECTORS
} from "../src/knowledge/commands.js";
import { loadKnowledgeDataset } from "../src/knowledge/dataset.js";
import {
  defaultKnowledgeVectorsPath,
  loadKnowledgeVectorFile,
  loadKnowledgeVectorFileIfExists,
  openKnowledgeVectorFileWriter,
  sanitizeKnowledgeModelForPath,
  writeKnowledgeVectorFile
} from "../src/knowledge/vectorFile.js";

describe("knowledge vector file paths", () => {
  it("uses a stable default vectors path next to the dataset", () => {
    expect(
      defaultKnowledgeVectorsPath(
        "data/knowledge/shellgei-basic.jsonl",
        "sirasagi62/ruri-v3-30m-ONNX"
      )
    ).toBe("data/knowledge/shellgei-basic.vectors.jsonl");
  });

  it("loads vector JSONL files with metadata and item lines", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      vectorsPath,
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 2,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        }),
        JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
        JSON.stringify({ type: "item", id: "pattern:count", vector: [0, 1] })
      ].join("\n") + "\n",
      "utf8"
    );

    await expect(loadKnowledgeVectorFile(vectorsPath)).resolves.toEqual({
      version: 2,
      itemCount: 2,
      model: "test-model",
      dataset: "knowledge.jsonl",
      createdAt: "2026-06-30T00:00:00.000Z",
      items: [
        { id: "man:awk:-F", vector: [1, 0] },
        { id: "pattern:count", vector: [0, 1] }
      ]
    });
  });

  it("writes exact version 2 metadata and item lines incrementally", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    const writer = await openKnowledgeVectorFileWriter(vectorsPath, {
      model: "test-model",
      dataset: "knowledge.jsonl",
      createdAt: "2026-06-30T00:00:00.000Z",
      itemCount: 2
    });

    await writer.writeItem({ id: "man:awk:-F", vector: [1, 0] });
    await writer.writeItem({ id: "pattern:count", vector: [0, 1] });
    await writer.commit();

    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe(
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 2,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        }),
        JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
        JSON.stringify({ type: "item", id: "pattern:count", vector: [0, 1] }),
        ""
      ].join("\n")
    );
  });

  it("writes complete vector data in version 2 JSONL format", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");

    await writeKnowledgeVectorFile(vectorsPath, {
      model: "test-model",
      dataset: "knowledge.jsonl",
      createdAt: "2026-06-30T00:00:00.000Z",
      items: [{ id: "man:awk:-F", vector: [1, 0] }]
    });

    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe(
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 1,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        }),
        JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
        ""
      ].join("\n")
    );
  });

  it("reports the line number for malformed JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      vectorsPath,
      `${JSON.stringify({
        type: "metadata",
        version: 2,
        itemCount: 1,
        model: "test-model",
        dataset: "knowledge.jsonl",
        createdAt: "2026-06-30T00:00:00.000Z"
      })}\n{\n`,
      "utf8"
    );

    await expect(loadKnowledgeVectorFile(vectorsPath)).rejects.toThrow(
      /^Invalid knowledge vector file line 2:/
    );
  });

  it("reports the line number for unknown record types", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      vectorsPath,
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 1,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        }),
        JSON.stringify({ type: "footer" }),
        ""
      ].join("\n"),
      "utf8"
    );

    await expect(loadKnowledgeVectorFile(vectorsPath)).rejects.toThrow(
      "Invalid knowledge vector file line 2: unknown record type."
    );
  });

  it("returns null when the vector file does not exist", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));

    await expect(
      loadKnowledgeVectorFileIfExists(path.join(dir, "missing.vectors.jsonl"))
    ).resolves.toBeNull();
  });

  it("publishes an incremental file only when committed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(vectorsPath, "existing-cache\n", "utf8");
    const writer = await openKnowledgeVectorFileWriter(vectorsPath, {
      version: 2,
      itemCount: 1,
      model: "test-model",
      dataset: "knowledge.jsonl",
      createdAt: "2026-06-30T00:00:00.000Z"
    });

    await writer.writeItem({ id: "man:awk:-F", vector: [1, 0] });
    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe("existing-cache\n");
    expect(await fs.readdir(dir)).toHaveLength(2);

    await writer.commit();

    await expect(loadKnowledgeVectorFile(vectorsPath)).resolves.toMatchObject({
      version: 2,
      itemCount: 1,
      items: [{ id: "man:awk:-F", vector: [1, 0] }]
    });
    expect(await fs.readdir(dir)).toEqual(["knowledge.vectors.jsonl"]);
  });

  it("aborts an incremental file without changing the destination", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(vectorsPath, "existing-cache\n", "utf8");
    const writer = await openKnowledgeVectorFileWriter(vectorsPath, {
      version: 2,
      itemCount: 1,
      model: "test-model",
      dataset: "knowledge.jsonl",
      createdAt: "2026-06-30T00:00:00.000Z"
    });

    await writer.writeItem({ id: "man:awk:-F", vector: [1, 0] });
    await writer.abort();

    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe("existing-cache\n");
    expect(await fs.readdir(dir)).toEqual(["knowledge.vectors.jsonl"]);
  });

  it("preserves the destination when complete-file serialization fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(vectorsPath, "existing-cache\n", "utf8");

    await expect(
      writeKnowledgeVectorFile(vectorsPath, {
        model: "test-model",
        dataset: "knowledge.jsonl",
        createdAt: "2026-06-30T00:00:00.000Z",
        items: [{ id: "man:awk:-F", vector: [1n] }]
      })
    ).rejects.toThrow();

    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe("existing-cache\n");
    expect(await fs.readdir(dir)).toEqual(["knowledge.vectors.jsonl"]);
  });

  it("cleans up when the initial metadata write fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(vectorsPath, "existing-cache\n", "utf8");

    await expect(
      openKnowledgeVectorFileWriter(vectorsPath, {
        version: 2,
        itemCount: 0,
        model: "test-model",
        dataset: "knowledge.jsonl",
        createdAt: 1n
      })
    ).rejects.toThrow();

    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe("existing-cache\n");
    expect(await fs.readdir(dir)).toEqual(["knowledge.vectors.jsonl"]);
  });

  it.each([
    {
      name: "an item before metadata",
      records: [{ type: "item", id: "man:awk:-F", vector: [1, 0] }],
      error: "line 1: metadata record must be first"
    },
    {
      name: "duplicate metadata",
      records: [
        {
          type: "metadata",
          version: 2,
          itemCount: 0,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        },
        {
          type: "metadata",
          version: 2,
          itemCount: 0,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        }
      ],
      error: "line 2: duplicate metadata record"
    },
    {
      name: "an unsupported version",
      records: [
        {
          type: "metadata",
          version: 1,
          itemCount: 0,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        }
      ],
      error: "line 1: unsupported version 1"
    },
    {
      name: "an invalid item count",
      records: [
        {
          type: "metadata",
          version: 2,
          itemCount: -1,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        }
      ],
      error: "line 1: itemCount must be a nonnegative integer"
    },
    {
      name: "a blank item id",
      records: [
        {
          type: "metadata",
          version: 2,
          itemCount: 1,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        },
        { type: "item", id: " ", vector: [1, 0] }
      ],
      error: "line 2: item id must be a nonblank string"
    },
    {
      name: "a nonnumeric vector value",
      records: [
        {
          type: "metadata",
          version: 2,
          itemCount: 1,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        },
        { type: "item", id: "man:awk:-F", vector: [1, "bad"] }
      ],
      error: "line 2: item vector must contain only finite numbers"
    }
  ])("rejects $name", async ({ records, error }) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      vectorsPath,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8"
    );

    await expect(loadKnowledgeVectorFile(vectorsPath)).rejects.toThrow(error);
  });

  it("rejects a cleanly truncated vector file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.jsonl");
    await fs.writeFile(
      vectorsPath,
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
          itemCount: 2,
          model: "test-model",
          dataset: "knowledge.jsonl",
          createdAt: "2026-06-30T00:00:00.000Z"
        }),
        JSON.stringify({ type: "item", id: "man:awk:-F", vector: [1, 0] }),
        ""
      ].join("\n"),
      "utf8"
    );

    await expect(loadKnowledgeVectorFile(vectorsPath)).rejects.toThrow(
      "expected 2 item records, found 1"
    );
  });

  it("loads legacy version 1 single-object vector files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-vectors-"));
    const vectorsPath = path.join(dir, "knowledge.vectors.json");
    const legacyFile = {
      version: 1,
      model: "legacy-model",
      dataset: "knowledge.jsonl",
      createdAt: "2026-06-29T00:00:00.000Z",
      items: [{ id: "man:awk:-F", vector: [1, 0] }]
    };
    await fs.writeFile(vectorsPath, `${JSON.stringify(legacyFile)}\n`, "utf8");

    await expect(loadKnowledgeVectorFile(vectorsPath)).resolves.toEqual(legacyFile);
  });

  it("loads the packaged default version 2 cache for every seed record", async () => {
    const records = await loadKnowledgeDataset(DEFAULT_KNOWLEDGE_DATASET);
    const vectorFile = await loadKnowledgeVectorFile(DEFAULT_KNOWLEDGE_VECTORS);

    expect(vectorFile.version).toBe(2);
    expect(vectorFile.itemCount).toBe(vectorFile.items.length);
    expect(vectorFile.items.map(({ id }) => id)).toEqual(records.map(({ id }) => id));
  });

  it("sanitizes model names for file paths", () => {
    expect(sanitizeKnowledgeModelForPath("owner/model name@rev")).toBe(
      "owner.model-name-rev"
    );
  });
});
