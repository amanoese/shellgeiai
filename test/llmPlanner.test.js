import { describe, expect, it, vi } from "vitest";
import { buildLlmPlan } from "../src/planner/llmPlanner.js";

describe("buildLlmPlan", () => {
  it("uses structured outputs and returns parsed variants", async () => {
    const parse = vi.fn(async () => ({
      output_parsed: {
        variants: [
          {
            variantId: "variant-1",
            label: "factor-first",
            approach: "external-utility",
            toolBias: ["seq", "factor", "awk"],
            intent: "Check whether factor expresses the predicate cleanly.",
            constraints: ["Prefer concise one-liners"],
            avoid: ["double parsing"],
            explorationHint: "Try seq + factor before custom logic."
          }
        ]
      }
    }));

    const plan = await buildLlmPlan(
      {
        problem: {
          raw: "1から100までの素数を出力してください",
          problemText: "1から100までの素数を出力してください"
        },
        mode: "parallel",
        parallelism: 3,
        maxIterations: 2
      },
      {
        apiKey: "test-key",
        client: { responses: { parse } }
      }
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0][0]).toMatchObject({
      model: expect.any(String),
      text: { format: expect.any(Object) }
    });
    expect(plan.variants[0].toolBias).toEqual(["seq", "factor", "awk"]);
    expect(plan.promptVersion).toBe("2026-06-13-llm-planner-v1");
    expect(plan.rawResponse).toBeNull();
  });

  it("fails clearly when structured output parsing yields no parsed plan", async () => {
    const parse = vi.fn(async () => ({ output_parsed: null }));

    await expect(
      buildLlmPlan(
        {
          problem: { raw: "print 123", problemText: "print 123" },
          mode: "single",
          parallelism: 1,
          maxIterations: 1
        },
        {
          apiKey: "test-key",
          client: { responses: { parse } }
        }
      )
    ).rejects.toThrow("The planner model returned no parsed structured output.");
  });
});
