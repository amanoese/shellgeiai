import { getFallbackReason } from "../planner/plannerFallback.js";
import { llmPlanner } from "../planner/llmPlanner.js";
import { buildRuleBasedPlan } from "../planner/ruleBasedPlanner.js";
import { normalizePlannerResult } from "../planner/plannerSchema.js";
import { buildPlannerTelemetry } from "../planner/plannerTelemetry.js";

function withPlannerTelemetry(plan, telemetry) {
  return {
    ...plan,
    planner: buildPlannerTelemetry({
      ...plan.planner,
      ...telemetry
    })
  };
}

export async function createExecutionPlan(session) {
  const primaryProvider = session.plannerProvider ?? llmPlanner;

  try {
    const rawPlan = await primaryProvider.buildPlan(session);
    const normalizedPlan = normalizePlannerResult(rawPlan, session, {
      provider: primaryProvider.name ?? "llm",
      attemptedProvider: primaryProvider.name ?? "llm",
      promptVersion: rawPlan?.promptVersion ?? null,
      prompt: rawPlan?.prompt ?? null,
      rawResponse: rawPlan?.rawResponse ?? null
    });
    const fallbackReason = getFallbackReason(normalizedPlan);

    if (!fallbackReason) {
      return normalizedPlan;
    }

    return withPlannerTelemetry(buildRuleBasedPlan(session), {
      attemptedProvider: primaryProvider.name ?? "llm",
      fallbackReason,
      promptVersion: rawPlan?.promptVersion ?? null,
      prompt: rawPlan?.prompt ?? null,
      rawResponse: rawPlan?.rawResponse ?? null
    });
  } catch (error) {
    return withPlannerTelemetry(buildRuleBasedPlan(session), {
      attemptedProvider: primaryProvider.name ?? "llm",
      fallbackReason: getFallbackReason(null, error)
    });
  }
}
