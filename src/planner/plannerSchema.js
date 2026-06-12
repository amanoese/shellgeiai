import { z } from "zod";

import { buildStrategyProfile, getStrategyName } from "./strategyCatalog.js";

export const toolSuggestionSchema = z.object({
  summary: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  suggestedTools: z.array(z.string().trim().min(1)).min(1)
});

export const variantSchema = z.object({
  variantId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  approach: z.string().trim().min(1),
  toolBias: z.array(z.string().trim().min(1)).default([]),
  intent: z.string().trim().min(1),
  constraints: z.array(z.string().trim().min(1)).default([]),
  avoid: z.array(z.string().trim().min(1)).default([]),
  explorationHint: z.string().trim().min(1),
  toolSuggestions: z.array(toolSuggestionSchema).default([])
});

export const plannerResultSchema = z.object({
  variants: z.array(variantSchema).min(1)
});

export function normalizePlannerResult(rawPlan, session, plannerMeta) {
  const source =
    rawPlan &&
    typeof rawPlan === "object" &&
    rawPlan.plan &&
    typeof rawPlan.plan === "object"
      ? rawPlan.plan
      : rawPlan;
  const parsed = plannerResultSchema.parse(source);
  const workerCount = Math.max(1, session.parallelism ?? 1);

  return {
    mode: session.mode ?? "single",
    parallelism: workerCount,
    variants: parsed.variants,
    workerTasks: Array.from({ length: workerCount }, (_, index) => ({
      workerId: `worker-${index + 1}`,
      strategy: getStrategyName(index),
      strategyProfile: buildStrategyProfile(index),
      assignedVariant: parsed.variants[index % parsed.variants.length],
      maxAttempts: session.maxIterations
    })),
    planner: {
      provider: plannerMeta.provider,
      attemptedProvider: plannerMeta.attemptedProvider ?? plannerMeta.provider,
      fallbackReason: plannerMeta.fallbackReason ?? null,
      promptVersion: plannerMeta.promptVersion ?? null,
      prompt: plannerMeta.prompt ?? null,
      rawResponse: plannerMeta.rawResponse ?? null
    }
  };
}
