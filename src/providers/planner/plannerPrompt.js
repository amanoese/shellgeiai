export const PLANNER_PROMPT_VERSION = "2026-06-13-llm-planner-v1";

export function buildPlannerSystemPrompt() {
  return [
    "You are ShellGeiAI planner.",
    "Return JSON only.",
    "Do not write full candidate shell commands.",
    "Do not ask to execute commands.",
    "Produce lightweight exploration variants for parallel workers.",
    "Prefer concise, safe, reproducible shell-gei exploration directions."
  ].join("\n");
}

export function buildPlannerUserPrompt(session) {
  return [
    `Prompt version: ${PLANNER_PROMPT_VERSION}`,
    `Problem: ${session.problem?.problemText ?? ""}`,
    session.problem?.expectedOutput ? `Expected output: ${session.problem.expectedOutput}` : "",
    `Mode: ${session.mode ?? "single"}`,
    `Parallelism: ${Math.max(1, session.parallelism ?? 1)}`,
    `Max iterations: ${session.maxIterations ?? 1}`,
    "Return an object `variants` with array field.",
    "Each variant must include variantId, label, approach, toolBias, intent, constraints, avoid, explorationHint, toolSuggestions.",
    "Each tool suggestion must include summary, rationale, suggestedTools.",
    "suggestedTools must contain only tool names such as awk, sed, grep, factor, seq.",
    "Do not include dangerous suggestions. Planning only."
  ]
    .filter(Boolean)
    .join("\n");
}
