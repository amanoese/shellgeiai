import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

export function knowledgeRecord(id, text = id, command = id) {
  return { id, kind: "note", command, option: "", text, source: "test" };
}

export async function knowledgeFixture(records = [knowledgeRecord("awk", "awk columns"), knowledgeRecord("sort", "sort values")]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shellgeiai-sqlite-runtime-"));
  const datasetPath = path.join(dir, "knowledge.jsonl");
  const dbPath = path.join(dir, "knowledge.sqlite");
  await fs.writeFile(datasetPath, records.map(record => JSON.stringify(record)).join("\n"));
  return { dir, datasetPath, dbPath, model: "test-model", records };
}

export function documentEmbedder() {
  return { embedBatch: vi.fn(async texts => texts.map(text => text.includes("awk") ? [1, 0] : [0, 1])) };
}
