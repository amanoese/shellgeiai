import { describe, expect, it } from "vitest";
import { createExecutionPlan } from "../src/core/planner.js";
import { createSolveRuntime } from "../src/core/runtime.js";
import { OpenAIEngine } from "../src/engines/openaiEngine.js";
import { DockerRunner } from "../src/runner/dockerRunner.js";

describe("createExecutionPlan", () => {
  it("returns a workerTask contract that matches the requested parallelism", () => {
    const plan = createExecutionPlan({
      mode: "parallel",
      parallelism: 3,
      maxIterations: 2
    });

    expect(plan).toEqual({
      mode: "parallel",
      parallelism: 3,
      workerTasks: [
        {
          workerId: "worker-1",
          strategy: "default",
          strategyProfile: {
            name: "balanced-search",
            focus: "Start with the most direct safe one-liner and keep the command shape simple.",
            retryHint: "Keep the command close to the previous attempt and adjust only the failing part."
          },
          maxAttempts: 2
        },
        {
          workerId: "worker-2",
          strategy: "awk-first",
          strategyProfile: {
            name: "awk-centric",
            focus: "Prefer awk for column-oriented or record-oriented transformations.",
            retryHint: "Retry by refining field separators, filters, or print formatting before changing tools."
          },
          maxAttempts: 2
        },
        {
          workerId: "worker-3",
          strategy: "text-filter",
          strategyProfile: {
            name: "filter-pipeline",
            focus: "Prefer grep, sed, tr, and shell pipelines for text filtering and selection.",
            retryHint: "Retry with a narrower pipeline when the first attempt is too broad."
          },
          maxAttempts: 2
        }
      ]
    });
  });
});

describe("createSolveRuntime", () => {
  it("creates an OpenAI engine and docker runner by default", () => {
    const runtime = createSolveRuntime({
      engine: "openai",
      openai: {
        client: {
          responses: {
            create: async () => ({ output_text: '{"command":"printf \\"ok\\\\n\\"","explanation":"test"}' })
          }
        }
      }
    });

    expect(runtime.engine).toBeInstanceOf(OpenAIEngine);
    expect(runtime.runner).toBeInstanceOf(DockerRunner);
  });

  it("creates a docker runner when requested", () => {
    const runtime = createSolveRuntime({
      engine: "mock",
      runner: "docker"
    });

    expect(runtime.runner).toBeInstanceOf(DockerRunner);
    expect(runtime.runner.name).toBe("docker");
  });
});
