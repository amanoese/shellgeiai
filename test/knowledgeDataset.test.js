import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadKnowledgeDataset, normalizeKnowledgeRecord } from "../src/knowledge/dataset.js";

describe("knowledge dataset", () => {
  const tempDirs = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeDatasetFixture(content) {
    const dir = await mkdtemp(join(tmpdir(), "shellgeiai-knowledge-"));
    tempDirs.push(dir);
    const file = join(dir, "dataset.jsonl");
    await writeFile(file, content, "utf8");
    return file;
  }

  it("normalizes minimal command option record", () => {
    expect(
      normalizeKnowledgeRecord({
        id: "man:awk:-F",
        kind: "option",
        command: "awk",
        option: "-F",
        text: "awk -F: 入力フィールドの区切り文字を指定する。",
        source: "man awk"
      })
    ).toEqual({
      id: "man:awk:-F",
      kind: "option",
      command: "awk",
      option: "-F",
      text: "awk -F: 入力フィールドの区切り文字を指定する。",
      source: "man awk"
    });
  });

  it("loads seed JSONL dataset", async () => {
    const records = await loadKnowledgeDataset("data/knowledge/shellgei-basic.jsonl");
    expect(records.length).toBeGreaterThanOrEqual(85);
    expect(records.map((record) => record.id)).toContain("man:awk:-F");
    expect(records.every((record) => record.text.length > 0)).toBe(true);

    const commands = new Set(
      records
        .flatMap((record) => record.command.split("|"))
        .map((command) => command.trim())
        .filter(Boolean)
    );
    expect(Array.from(commands)).toEqual(
      expect.arrayContaining([
        "awk",
        "sed",
        "grep",
        "sort",
        "uniq",
        "xargs",
        "find",
        "cut",
        "tr",
        "wc",
        "head",
        "tail",
        "seq",
        "paste",
        "join",
        "comm",
        "fmt",
        "perl",
        "rev",
        "tac",
        "zcat",
        "wget",
        "curl",
        "factor",
        "nkf",
        "printf",
        "yes",
        "fold",
        "xxd",
        "jq"
      ])
    );
  });

  it("wraps malformed JSON with line number", async () => {
    const file = await writeDatasetFixture("{");

    await expect(loadKnowledgeDataset(file)).rejects.toThrow(/^Invalid knowledge dataset line 1:/);
  });

  it("wraps invalid kind with line number", async () => {
    const file = await writeDatasetFixture(
      `${JSON.stringify({ id: "bad-kind", kind: "unknown", text: "bad kind" })}\n`
    );

    await expect(loadKnowledgeDataset(file)).rejects.toThrow(/^Invalid knowledge dataset line 1:/);
  });

  it("requires non-blank record id", () => {
    expect(() => normalizeKnowledgeRecord({ id: "  ", kind: "note", text: "missing id" })).toThrow(
      "Knowledge record id is required."
    );
  });

  it("requires non-blank record text", () => {
    expect(() => normalizeKnowledgeRecord({ id: "blank-text", kind: "note", text: "  " })).toThrow(
      "Knowledge record blank-text text is required."
    );
  });

  it("ignores blank lines when loading dataset", async () => {
    const file = await writeDatasetFixture(
      [
        "",
        JSON.stringify({ id: "first", kind: "note", text: "first note" }),
        "   ",
        JSON.stringify({ id: "second", kind: "pattern", text: "second note" }),
        ""
      ].join("\n")
    );

    const records = await loadKnowledgeDataset(file);

    expect(records.map((record) => record.id)).toEqual(["first", "second"]);
  });
});
