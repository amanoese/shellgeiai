export const MAX_KNOWLEDGE_RESULT_TEXT_CHARS = 300;

function truncateText(text) {
  const value = typeof text === "string" ? text : "";
  if (value.length <= MAX_KNOWLEDGE_RESULT_TEXT_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_KNOWLEDGE_RESULT_TEXT_CHARS)}...`;
}

export function formatKnowledgeRecords(records, { limit = 5 } = {}) {
  return records.slice(0, limit).map((record) => ({
    id: record.id ?? "",
    command: record.command ?? "",
    option: record.option ?? "",
    text: truncateText(record.text),
    source: record.source ?? ""
  }));
}
