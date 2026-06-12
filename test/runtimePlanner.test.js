import { describe, expect, it, vi } from "vitest";
import { createExecutionPlan } from "../src/core/planner.js";
import { createSolveRuntime } from "../src/core/runtime.js";
import { OpenAIEngine } from "../src/engines/openaiEngine.js";
import { DockerRunner } from "../src/runner/dockerRunner.js";

describe("createExecutionPlan", () => {
  it("returns worker task profiles rubric guidance", async () => {
    const plan = await createExecutionPlan({
      mode: "parallel",
      parallelism: 3,
      maxIterations: 2
    });

    expect(plan).toEqual(
      expect.objectContaining({
        mode: "parallel",
        parallelism: 3,
        workerTasks: [
          expect.objectContaining({
            workerId: "worker-1",
            strategy: "default",
            strategyProfile: {
              name: "balanced-search",
              focus: "Start with direct safe one-liner.",
              retryHint: "Remove redundant stages before changing whole approach.",
              rubricFocus: ["conciseness", "shellness", "robustness"]
            },
            maxAttempts: 2
          }),
          expect.objectContaining({
            workerId: "worker-2",
            strategyProfile: expect.objectContaining({
              rubricFocus: expect.any(Array),
              retryHint: expect.stringContaining("Remove")
            })
          }),
          expect.objectContaining({
            workerId: "worker-3",
            strategyProfile: expect.objectContaining({
              rubricFocus: expect.any(Array)
            })
          })
        ]
      })
    );
  });

  it("creates variants and assigns one to each worker", async () => {
    const plan = await createExecutionPlan({
      mode: "parallel",
      parallelism: 4,
      maxIterations: 2,
      problem: {
        raw: "1から100までの素数を出力してください",
        problemText: "1から100までの素数を出力してください"
      }
    });

    expect(plan.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: expect.any(String),
          label: expect.any(String),
          approach: expect.any(String),
          toolBias: expect.any(Array),
          intent: expect.any(String),
          constraints: expect.any(Array),
          avoid: expect.any(Array),
          explorationHint: expect.any(String)
        })
      ])
    );
    expect(plan.workerTasks[0].assignedVariant).toEqual(
      expect.objectContaining({
        variantId: expect.any(String),
        approach: expect.any(String)
      })
    );
  });

  it("diversifies variants for prime-number problems", async () => {
    const plan = await createExecutionPlan({
      mode: "parallel",
      parallelism: 5,
      maxIterations: 2,
      problem: {
        raw: "1から100までの素数を出力してください",
        problemText: "1から100までの素数を出力してください"
      }
    });

    const approaches = plan.variants.map((variant) => variant.approach);

    expect(approaches).toContain("awk-record-pass");
    expect(approaches).toContain("shell-loop-or-seq");
    expect(
      approaches.some((name) => name === "external-utility" || name === "filter-pipeline")
    ).toBe(true);
    expect(new Set(plan.workerTasks.map((task) => task.assignedVariant?.variantId)).size).toBeGreaterThan(1);
  });

  it("falls back to rule-based planner when llm plan is invalid", async () => {
    const plannerProvider = {
      buildPlan: vi.fn(async () => ({
        provider: "llm",
        rawResponse: "{\"variants\":[]}",
        variants: [],
        workerTasks: []
      }))
    };

    const plan = await createExecutionPlan({
      mode: "parallel",
      parallelism: 2,
      maxIterations: 2,
      problem: {
        raw: "print 123",
        problemText: "print 123"
      },
      plannerProvider
    });

    expect(plannerProvider.buildPlan).toHaveBeenCalledTimes(1);
    expect(plan.planner.provider).toBe("rule-based");
    expect(plan.planner.fallbackReason).toEqual(expect.any(String));
    expect(plan.variants.length).toBeGreaterThan(0);
    expect(plan.workerTasks[0].assignedVariant).toEqual(
      expect.objectContaining({
        variantId: expect.any(String)
      })
    );
  });
});

describe("createSolveRuntime", () => {
  it("creates an OpenAI engine and docker runner by default", () => {
    const runtime = createSolveRuntime({
      engine: "openai",
      openai: {
        client: {
          responses: {
            create: async () => ({
              output_text: '{"command":"printf \\"ok\\\\n\\"","explanation":"test"}'
            })
          }
        }
      }
    });

    expect(runtime.engine).toBeInstanceOf(OpenAIEngine);
    expect(runtime.runner).toBeInstanceOf(DockerRunner);
  });

  it("creates docker runner when requested", () => {
    const runtime = createSolveRuntime({ engine: "mock", runner: "docker" });

    expect(runtime.runner).toBeInstanceOf(DockerRunner);
    expect(runtime.runner.name).toBe("docker");
  });
});
