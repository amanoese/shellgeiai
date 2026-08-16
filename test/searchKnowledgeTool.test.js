import { describe, expect, it, vi } from "vitest";

import { createSearchKnowledgeTool } from "../src/knowledge/searchKnowledgeTool.js";
import {
  MAX_KNOWLEDGE_RESULT_FIELD_CHARS
} from "../src/knowledge/hints.js";
import { createToolRegistry } from "../src/tools/toolRegistry.js";

function createTool(records = []) {
  const retriever = {
    search: vi.fn(async () => records)
  };

  return {
    retriever,
    tool: createSearchKnowledgeTool({ retriever })
  };
}

describe("createSearchKnowledgeTool", () => {
  it("defines the read-only search_knowledge tool", () => {
    const { tool } = createTool();

    expect(tool.name).toBe("search_knowledge");
    expect(tool.description).toMatch(/search/i);
    expect(tool.description).toMatch(/read-only/i);
  });

  it("trims a valid query before executing through the registry", async () => {
    const { retriever, tool } = createTool();
    const registry = createToolRegistry();
    registry.register(tool);

    const result = await registry.execute({
      name: "search_knowledge",
      arguments: { query: "  awk field splitting  " }
    });

    expect(result).toEqual({
      ok: true,
      value: { records: [] },
      validatedArguments: { query: "awk field splitting" }
    });
    expect(retriever.search).toHaveBeenCalledWith({ query: "awk field splitting" });
  });

  it.each([
    ["an empty query", { query: "" }],
    ["a whitespace-only query", { query: "   \n\t" }],
    ["a query longer than 500 characters", { query: "x".repeat(501) }],
    ["an extra key", { query: "awk", extra: true }]
  ])("rejects %s", (_label, input) => {
    const { tool } = createTool();

    expect(tool.inputSchema.safeParse(input).success).toBe(false);
  });

  it("returns at most five records using the shared bounded-field format", async () => {
    const oversized = "x".repeat(MAX_KNOWLEDGE_RESULT_FIELD_CHARS + 1);
    const records = Array.from({ length: 7 }, (_, index) => ({
      id: index === 0 ? oversized : `record-${index}`,
      command: index === 0 ? oversized : "awk",
      option: index === 0 ? oversized : "-F",
      text: index === 0 ? oversized : `text-${index}`,
      source: index === 0 ? oversized : "test",
      score: 1 - index / 10
    }));
    const { retriever, tool } = createTool(records);

    const result = await tool.execute({ query: "awk" });

    expect(retriever.search).toHaveBeenCalledWith({ query: "awk" });
    expect(result.records).toHaveLength(5);
    expect(result.records[0]).toEqual({
      id: `${"x".repeat(MAX_KNOWLEDGE_RESULT_FIELD_CHARS)}...`,
      command: `${"x".repeat(MAX_KNOWLEDGE_RESULT_FIELD_CHARS)}...`,
      option: `${"x".repeat(MAX_KNOWLEDGE_RESULT_FIELD_CHARS)}...`,
      text: `${"x".repeat(MAX_KNOWLEDGE_RESULT_FIELD_CHARS)}...`,
      source: `${"x".repeat(MAX_KNOWLEDGE_RESULT_FIELD_CHARS)}...`
    });
    expect(result.records.map((record) => record.id)).toEqual([
      `${"x".repeat(MAX_KNOWLEDGE_RESULT_FIELD_CHARS)}...`,
      "record-1",
      "record-2",
      "record-3",
      "record-4"
    ]);
  });
});
