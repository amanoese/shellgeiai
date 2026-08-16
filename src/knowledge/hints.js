export const MAX_KNOWLEDGE_RESULT_FIELD_CHARS = 300;
export const MAX_KNOWLEDGE_RESULT_TEXT_CHARS = MAX_KNOWLEDGE_RESULT_FIELD_CHARS;

function truncateField(value) {
  const stringValue = typeof value === "string" ? value : "";
  if (stringValue.length <= MAX_KNOWLEDGE_RESULT_FIELD_CHARS) {
    return stringValue;
  }
  return `${stringValue.slice(0, MAX_KNOWLEDGE_RESULT_FIELD_CHARS)}...`;
}

export function formatKnowledgeRecords(records, { limit = 5 } = {}) {
  return records.slice(0, limit).map((record) => ({
    id: truncateField(record.id),
    command: truncateField(record.command),
    option: truncateField(record.option),
    text: truncateField(record.text),
    source: truncateField(record.source)
  }));
}
