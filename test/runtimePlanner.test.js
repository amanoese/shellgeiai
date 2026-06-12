import { describe, expect, it, vi } from "vitest";

import { createExecutionPlan } from "../src/core/planner.js";
import { createSolveRuntime } from "../src/core/runtime.js";
import { OpenAIEngine } from "../src/engines/openaiEngine.js";
import { DockerRunner } from "../src/runner/dockerRunner.js";

describe("createExecutionPlan", () => {
  it("returns worker task profiles with rubric guidance", async () => {
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

  it("creates variants, seeds tool suggestions, and assigns one to each worker", async () => {
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
          toolSuggestions: expect.any(Array)
        })
      ])
    );
    expect(plan.variants[0].toolSuggestions[0]).toEqual(
      expect.objectContaining({
        summary: expect.any(String),
        rationale: expect.any(String),
        suggestedTools: expect.any(Array)
      })
    );
    expect(plan.workerTasks).toHaveLength(4);
    expect(plan.workerTasks[0].assignedVariant).toEqual(plan.variants[0]);
  });
});

describe("createSolveRuntime", () => {
  it("creates default OpenAI engine and Docker runner", () => {
    const runtime = createSolveRuntime({
      openai: {
        apiKey: "test-key",
        client: {
          responses: {
            create: vi.fn(async () => ({
              output_text: '{"command":"printf \\"ok\\\\n\\"","explanation":"test"}'
            }))
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
