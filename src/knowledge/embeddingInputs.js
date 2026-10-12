export const EMBEDDING_INPUT_PROFILE = "qwen-retrieval-v1";

export function formatEmbeddingQuery(text) {
  return `Instruct: Given a shell scripting question, retrieve relevant command documentation and examples.\nQuery: ${text}`;
}

export function formatEmbeddingDocument(record) {
  return record.text;
}
