import { MockEngine } from "../providers/engines/mockEngine.js";
import { OpenAIEngine } from "../providers/engines/openaiEngine.js";
import { SimpleJudge } from "../execution/judge/simpleJudge.js";
import { DockerRunner } from "../execution/runner/dockerRunner.js";
import { LocalRunner } from "../execution/runner/localRunner.js";

const DEFAULT_RUNNER = "docker";

function createEngine(name, options) {
  switch (name) {
    case "openai":
    case undefined:
      return new OpenAIEngine(options);
    case "mock":
      return new MockEngine();
    default:
      throw new Error(`Unsupported engine: ${String(name)}`);
  }
}

function createRunner(name) {
  switch (name ?? DEFAULT_RUNNER) {
    case "local":
      return new LocalRunner();
    case "docker":
      return new DockerRunner();
    default:
      throw new Error(`Unsupported runner: ${String(name)}`);
  }
}

export function createSolveRuntime(config) {
  return {
    engine: createEngine(config.engine, config.openai),
    runner: createRunner(config.runner),
    judge: new SimpleJudge()
  };
}
