import { describe, expect, it, vi } from "vitest";

import { createExecutionPlan } from "../src/core/planner.js";
import { createSolveRuntime } from "../src/core/runtime.js";
import { OpenAIEngine } from "../src/engines/openaiEngine.js";
import { DockerRunner } from "../src/runner/dockerRunner.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

describe("createExecutionPlan", () => {
  it("uses the LLM planner by default", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(
      createExecutionPlan({
        mode: "parallel",
        parallelism: 3,
        maxIterations: 2
      })
    ).rejects.toThrow("OPENAI_API_KEY is not set for LLM planner.");
  });

  it("returns worker tasks from LLM planner variants", async () => {
    const plan = await createExecutionPlan({
      mode: "parallel",
      parallelism: 3,
      maxIterations: 2,
      plannerProvider: createTestPlannerProvider()
    });

    expect(plan).toEqual(
      expect.objectContaining({
        mode: "parallel",
        parallelism: 3,
        workerTasks: [
          expect.objectContaining({
            workerId: "worker-1",
            strategy: "direct-shell",
            assignedVariant: expect.objectContaining({ variantId: "variant-1" }),
            strategyProfile: expect.objectContaining({
              name: "direct-shell",
              focus: "Use a direct shell pipeline.",
              retryHint: "Prefer the simplest command that can produce the expected output.",
              rubricFocus: ["awk", "sed"]
            }),
            maxAttempts: 2
          }),
          expect.objectContaining({
            workerId: "worker-2",
            strategyProfile: expect.objectContaining({
              name: "pipeline-shell",
              rubricFocus: ["grep", "sort"]
            })
          }),
          expect.objectContaining({
            workerId: "worker-3",
            strategyProfile: expect.objectContaining({
              name: "direct-shell"
            })
          })
        ]
      })
    );
  });

  it("normalizes LLM variants and assigns one to each worker", async () => {
    const plan = await createExecutionPlan({
      mode: "parallel",
      parallelism: 4,
      maxIterations: 2,
      plannerProvider: createTestPlannerProvider(),
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
