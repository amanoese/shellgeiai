export const SUPPORTED_KNOWLEDGE_MODES = new Set([
  "off",
  "planner",
  "worker",
  "all",
  "on"
]);

export function normalizeKnowledgeMode(mode = "off") {
  return mode === "on" ? "all" : mode;
}

export function usesPlannerKnowledge(mode) {
  const normalizedMode = normalizeKnowledgeMode(mode);
  return normalizedMode === "planner" || normalizedMode === "all";
}

export function usesWorkerKnowledge(mode) {
  const normalizedMode = normalizeKnowledgeMode(mode);
  return normalizedMode === "worker" || normalizedMode === "all";
}
