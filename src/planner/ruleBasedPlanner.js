import { buildStrategyProfile, getStrategyName } from "./strategyCatalog.js";
import { seedToolSuggestions } from "./toolSuggestionSeeder.js";

function buildVariants(problemText, seededSuggestions) {
  const text = String(problemText ?? "");
  const lowerText = text.toLowerCase();
  const sharedSuggestions = seededSuggestions.slice(0, 2);
  const variants = [
    {
      variantId: "variant-awk",
      label: "awk-first",
      approach: "awk-record-pass",
      toolBias: ["awk"],
      intent: "Start with compact one-pass transform before adding extra stages.",
      constraints: ["Prefer concise one-liners", "Keep stdin/stdout flow natural"],
      avoid: ["multiple passes", "temporary files"],
      explorationHint: "Try single awk-driven pass before mixing more tools.",
      toolSuggestions: sharedSuggestions
    },
    {
      variantId: "variant-pipeline",
      label: "pipeline-first",
      approach: "filter-pipeline",
      toolBias: ["grep", "sed", "tr", "paste"],
      intent: "Decompose the task into a stream-oriented pipeline if it reads more clearly.",
      constraints: ["Keep each stage purposeful", "Prefer standard text filters"],
      avoid: ["embedded scripts"],
      explorationHint: "Prefer a natural stdin/stdout pipeline with small standard tools.",
      toolSuggestions: sharedSuggestions
    },
    {
      variantId: "variant-loop",
      label: "enumerate-first",
      approach: "shell-loop-or-seq",
      toolBias: ["seq", "sh", "xargs"],
      intent: "Treat the problem as enumeration plus filtering when the domain is naturally generated.",
      constraints: ["Generate only data you need", "Keep the loop compact"],
      avoid: ["awk-only contortions"],
      explorationHint: "Start with sequence generation, then prune, before forcing one giant expression.",
      toolSuggestions: sharedSuggestions
    },
    {
      variantId: "variant-normalize",
      label: "normalize-first",
      approach: "normalization-first",
      toolBias: ["tr", "sed", "awk"],
      intent: "Reshape the stream early when normalized records make later logic simpler.",
      constraints: ["Stabilize separators before complex logic", "Prefer reproducible text shaping"],
      avoid: ["late cleanup", "format drift"],
      explorationHint: "Normalize separators or line shape first if the raw stream is noisy.",
      toolSuggestions: sharedSuggestions
    }
  ];

  if (/prime|素数/.test(text) || lowerText.includes("prime")) {
    variants.push({
      variantId: "variant-factor",
      label: "factor-first",
      approach: "external-utility",
      toolBias: ["seq", "factor", "awk"],
      intent: "Check whether existing Unix utilities express the predicate more cleanly than custom logic.",
      constraints: ["Lean on standard tools when they fit", "Keep the predicate transparent"],
      avoid: ["awk-only contortions", "double parsing"],
      explorationHint: "Consider seq + factor before custom primality logic.",
      toolSuggestions: [
        {
          summary: "既存 utility で判定を表現できるかを先に試す",
          rationale: "標準コマンドがハマると短く shell-gei らしい解法になりやすい",
          suggestedTools: ["factor", "seq", "awk"]
        },
        ...sharedSuggestions
      ]
    });
  }

  return variants;
}

export function buildRuleBasedPlan(session) {
  const workerCount = Math.max(1, session.parallelism ?? 1);
  const seededSuggestions =
    session.plannerInputs?.seededToolSuggestions ??
    seedToolSuggestions(session.problem?.problemText ?? "");
  const variants = buildVariants(session.problem?.problemText ?? "", seededSuggestions);

  return {
    mode: session.mode ?? "single",
    parallelism: workerCount,
    variants,
    workerTasks: Array.from({ length: workerCount }, (_, index) => ({
      workerId: `worker-${index + 1}`,
      strategy: getStrategyName(index),
      strategyProfile: buildStrategyProfile(index),
      assignedVariant: variants[index % variants.length],
      maxAttempts: session.maxIterations
    })),
    planner: {
      provider: "rule-based",
      attemptedProvider: null,
      fallbackReason: null,
      promptVersion: null,
      prompt: null,
      rawResponse: null
    }
  };
}
