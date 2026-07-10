import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
      createdAt: "2026-06-30T00:00:00.000Z"
    });

    await writer.writeItem({ id: "man:awk:-F", vector: [1, 0] });
    await writer.writeItem({ id: "pattern:count", vector: [0, 1] });
    await writer.close();

    await expect(fs.readFile(vectorsPath, "utf8")).resolves.toBe(
      [
        JSON.stringify({
          type: "metadata",
          version: 2,
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
      `${JSON.stringify({ type: "metadata", version: 2 })}\n{\n`,
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
        JSON.stringify({ type: "metadata", version: 2 }),
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

  it("sanitizes model names for file paths", () => {
    expect(sanitizeKnowledgeModelForPath("owner/model name@rev")).toBe(
      "owner.model-name-rev"
    );
  });
});
