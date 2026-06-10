import { describe, expect, it } from "vitest";
import { createExecutionPlan } from "../src/core/planner.js";
import { createSolveRuntime } from "../src/core/runtime.js";
import { OpenAIEngine } from "../src/engines/openaiEngine.js";
import { DockerRunner } from "../src/runner/dockerRunner.js";
import { LocalRunner } from "../src/runner/localRunner.js";

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
          maxAttempts: 2
        },
        {
          workerId: "worker-2",
          strategy: "awk-first",
          maxAttempts: 2
        },
        {
          workerId: "worker-3",
          strategy: "text-filter",
          maxAttempts: 2
        }
      ]
    });
  });
});

describe("createSolveRuntime", () => {
  it("creates an OpenAI engine and local runner by default", () => {
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
    expect(runtime.runner).toBeInstanceOf(LocalRunner);
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
