import { formatKnowledgeRecords } from "./hints.js";
import { searchKnowledgeRecords } from "./vectorSearch.js";

export function createKnowledgeRetriever({
  records = [],
  embedder
} = {}) {
  return {
    async retrieveForPlanner({ problem, expectedOutput }) {
      const query = [
        `検索クエリ: ${problem}`,
        expectedOutput ? `期待する出力: ${expectedOutput}` : ""
      ].filter(Boolean).join("\n");

      const results = await searchKnowledgeRecords({
        query,
        records,
        embedder,
        topK: 5,
        maxPerCommand: 1
      });
      return formatKnowledgeRecords(results);
    },

    async search({ query }) {
      const results = await searchKnowledgeRecords({
        query: `検索クエリ: ${query}`,
        records,
        embedder,
        topK: 5,
        maxPerCommand: 2
      });
      return formatKnowledgeRecords(results);
    }
  };
}
