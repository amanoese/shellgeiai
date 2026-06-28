export const DEFAULT_KNOWLEDGE_MODEL = "sirasagi62/ruri-v3-30m-ONNX";
export const KNOWLEDGE_MODEL_ENV = "SHELLGEIAI_KNOWLEDGE_MODEL";

export function resolveKnowledgeModel({ model, env = process.env } = {}) {
  return model ?? env[KNOWLEDGE_MODEL_ENV] ?? DEFAULT_KNOWLEDGE_MODEL;
}
