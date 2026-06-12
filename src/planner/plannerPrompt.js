export const PLANNER_PROMPT_VERSION = "2026-06-13-llm-planner-v1";

export function buildPlannerSystemPrompt() {
  return [
    "You are the ShellGeiAI planner.",
    "Return JSON only.",
    "Do not propose final shell commands.",
    "Do not ask to execute commands.",
    "Produce lightweight exploration variants for parallel workers.",
    "Prefer concise, shell-gei-like, safe, reproducible exploration plans.",
    "It is acceptable if multiple variants use similar tools, as long as their exploration intent differs."
  ].join(" ");
}

export function buildPlannerUserPrompt(session) {
  return [
    `Prompt version: ${PLANNER_PROMPT_VERSION}`,
    `Problem: ${session.problem?.problemText ?? ""}`,
    session.problem?.expectedOutput ? `Expected output: ${session.problem.expectedOutput}` : "",
    `Mode: ${session.mode ?? "single"}`,
    `Parallelism: ${Math.max(1, session.parallelism ?? 1)}`,
    `Max iterations: ${session.maxIterations ?? 1}`,
    "Return an object with a `variants` array.",
    "Each variant must include variantId, label, approach, toolBias, intent, constraints, avoid, explorationHint.",
    "Do not include dangerous suggestions. Planning only."
  ]
    .filter(Boolean)
    .join("\n");
}
