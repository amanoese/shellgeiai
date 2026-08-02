import { describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_RESULT_TEXT_CHARS,
  formatKnowledgeRecords
} from "../src/knowledge/hints.js";

describe("knowledge hint formatting", () => {
  it("selects only prompt-safe knowledge fields", () => {
    expect(formatKnowledgeRecords([{
      id: "awk:-F",
      kind: "option",
      command: "awk",
      option: "-F",
      text: "CSV の区切り文字を指定する",
      source: "man awk",
      score: 0.9,
      vector: [1, 0]
    }])).toEqual([{
      id: "awk:-F",
      command: "awk",
      option: "-F",
      text: "CSV の区切り文字を指定する",
      source: "man awk"
    }]);
  });

  it("limits the number of returned records", () => {
    const records = Array.from({ length: 4 }, (_, index) => ({
      id: `record-${index}`,
      command: "awk",
      option: "",
      text: `record ${index}`,
      source: "test"
    }));

    expect(formatKnowledgeRecords(records, { limit: 2 }).map((record) => record.id)).toEqual([
      "record-0",
      "record-1"
    ]);
  });

  it("normalizes missing fields to empty strings", () => {
    expect(formatKnowledgeRecords([{ id: "minimal" }])).toEqual([{
      id: "minimal",
      command: "",
      option: "",
      text: "",
      source: ""
    }]);
  });

  it("keeps text at the boundary and truncates longer text", () => {
    const boundaryText = "a".repeat(MAX_KNOWLEDGE_RESULT_TEXT_CHARS);
    const longerText = `${boundaryText}b`;
    const [boundary, truncated] = formatKnowledgeRecords([
      { id: "boundary", text: boundaryText },
      { id: "longer", text: longerText }
    ]);

    expect(boundary.text).toBe(boundaryText);
    expect(truncated.text).toBe(`${boundaryText}...`);
  });
});
