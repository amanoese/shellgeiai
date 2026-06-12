import { PLANNER_RUBRIC_DIGEST } from "./plannerRubric.js";

export const PLANNER_PROMPT_VERSION = "2026-06-13-llm-planner-v1";

export function buildPlannerSystemPrompt() {
  return [
    "You are ShellGeiAI planner.",
    "Return JSON only.",
    "Do not write full candidate shell commands.",
    "Do not ask to execute commands.",
    "Produce lightweight exploration variants for parallel workers.",
    "Use shellgei rubric guidance:",
    ...PLANNER_RUBRIC_DIGEST.map((line) => `- ${line}`)
  ].join("\n");
}

export function buildPlannerUserPrompt(session) {
  const seededToolSuggestions = session.plannerInputs?.seededToolSuggestions ?? [];

  return [
    `Prompt version: ${PLANNER_PROMPT_VERSION}`,
    `Problem: ${session.problem?.problemText ?? ""}`,
    session.problem?.expectedOutput ? `Expected output: ${session.problem.expectedOutput}` : "",
    `Mode: ${session.mode ?? "single"}`,
    `Parallelism: ${Math.max(1, session.parallelism ?? 1)}`,
    `Max iterations: ${session.maxIterations ?? 1}`,
    ...PLANNER_RUBRIC_DIGEST,
    "Return an object `variants` with array field.",
    "Each variant must include variantId, label, approach, toolBias, intent, constraints, avoid, explorationHint, toolSuggestions.",
    "Each tool suggestion must include summary, rationale, suggestedTools.",
    "suggestedTools must contain only tool names such as awk, sed, grep, factor, seq.",
    seededToolSuggestions.length
      ? `Seeded tool suggestions: ${JSON.stringify(seededToolSuggestions)}`
      : "",
    "Do not include dangerous suggestions. Planning only."
  ]
    .filter(Boolean)
    .join("\n");
}
