import { searchKnowledgeRecords } from "./vectorSearch.js";

export function createKnowledgeRetriever({
  mode = "off",
  records = [],
  embedder,
  topK = 10
} = {}) {
  return {
    async retrieveForWorker({ problem, task }) {
      if (mode !== "worker") {
        return [];
      }

      const query = [
        `検索クエリ: ${problem}`,
        task?.strategy ?? "",
        task?.strategyProfile?.focus ?? ""
      ].filter(Boolean).join("\n");

      return searchKnowledgeRecords({
        query,
        records,
        embedder,
        topK,
        maxPerCommand: 2
      });
    }
  };
}
