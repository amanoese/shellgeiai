export const DEFAULT_KNOWLEDGE_MODEL = "qwen/qwen3-embedding-8b";
export const KNOWLEDGE_MODEL_ENV = "SHELLGEIAI_KNOWLEDGE_MODEL";

export function resolveKnowledgeModel({ model, env = process.env } = {}) {
  return model ?? env[KNOWLEDGE_MODEL_ENV] ?? DEFAULT_KNOWLEDGE_MODEL;
}
