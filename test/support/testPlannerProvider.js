export function createTestPlannerProvider(variants = defaultVariants()) {
  return {
    name: "test-llm",
    async buildPlan() {
      return {
        variants,
        promptVersion: "test-planner-v1",
        prompt: "test planner prompt",
        rawResponse: JSON.stringify({ variants })
      };
    }
  };
}

function defaultVariants() {
  return [
    {
      variantId: "variant-1",
      label: "direct-shell",
      approach: "Use a direct shell pipeline.",
      toolBias: ["awk", "sed"],
      intent: "Solve the problem with a concise shell one-liner.",
      constraints: ["Keep commands safe."],
      avoid: ["Destructive commands."],
      explorationHint: "Prefer the simplest command that can produce the expected output.",
      toolSuggestions: [
        {
          summary: "Text processing",
          rationale: "The problem can be solved with standard shell text tools.",
          suggestedTools: ["awk"]
        }
      ]
    },
    {
      variantId: "variant-2",
      label: "pipeline-shell",
      approach: "Break the problem into a short pipeline.",
      toolBias: ["grep", "sort"],
      intent: "Explore a composable shell pipeline.",
      constraints: ["Keep output deterministic."],
      avoid: ["Network access."],
      explorationHint: "Use small pipeline stages only when they clarify the command.",
      toolSuggestions: [
        {
          summary: "Pipeline tools",
          rationale: "The problem may benefit from filtering or sorting.",
          suggestedTools: ["grep", "sort"]
        }
      ]
    }
  ];
}
