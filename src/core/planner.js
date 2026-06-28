import { llmPlanner } from "../providers/planner/llmPlanner.js";
import { normalizePlannerResult } from "../providers/planner/plannerSchema.js";

export async function createExecutionPlan(session) {
  const plannerProvider = session.plannerProvider ?? llmPlanner;
  if (!plannerProvider || typeof plannerProvider.buildPlan !== "function") {
    throw new Error("LLM planner provider is required.");
  }

  const rawPlan = await plannerProvider.buildPlan(session);
  return normalizePlannerResult(rawPlan, session, {
    provider: plannerProvider.name ?? "llm",
    attemptedProvider: plannerProvider.name ?? "llm",
    promptVersion: rawPlan?.promptVersion ?? null,
    prompt: rawPlan?.prompt ?? null,
    rawResponse: rawPlan?.rawResponse ?? null
  });
}
