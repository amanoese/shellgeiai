import { z } from "zod";

import { formatKnowledgeRecords } from "./hints.js";

export function createSearchKnowledgeTool({ retriever }) {
  return {
    name: "search_knowledge",
    description: "Search the local shell command knowledge base. This is a read-only operation.",
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(500)
      })
      .strict(),
    async execute({ query }) {
      const records = await retriever.search({ query });
      return {
        records: formatKnowledgeRecords(records, { limit: 5 })
      };
    }
  };
}
