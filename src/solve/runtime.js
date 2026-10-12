import { MockEngine } from "../providers/engines.js";
import { OpenAIEngine } from "../providers/apiEngine.js";
import { SimpleJudge } from "../execution/judge.js";
import { DockerRunner } from "../execution/dockerRunner.js";
import { LocalRunner } from "../execution/localRunner.js";
import { resolveLlmConfig } from "../providers/llm.js";
import { createLlmPlanner } from "../providers/planner.js";

const DEFAULT_RUNNER = "docker";

function createEngine(name, options) {
  if (name && typeof name === "object") return name;
  switch (name) {
    case "api":
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

export function createSolveRuntime(config = {}) {
  const options = config.llm ?? config.openai ?? {};
  const injectedEngine = config.engine && typeof config.engine === "object";
  if (!injectedEngine && ![undefined, "api", "openai", "mock"].includes(config.engine)) {
    throw new Error(`Unsupported engine: ${String(config.engine)}`);
  }
  const runner = createRunner(config.runner);
  const needsApiEngine = !injectedEngine && config.engine !== "mock";
  const needsApiPlanner = config.plannerProvider == null;
  const llmConfig = config.llmConfig ?? config.engine?.llmConfig ?? (
    needsApiEngine || needsApiPlanner
      ? resolveLlmConfig(options.client && options.apiKey === undefined
          ? { ...options, apiKey: "injected-client" } : options)
      : undefined
  );
  const inheritedEngine = injectedEngine && llmConfig === config.engine.llmConfig ? config.engine : undefined;
  return {
    engine: createEngine(config.engine, { ...options, config: llmConfig }),
    runner,
    judge: new SimpleJudge(),
    plannerProvider: config.plannerProvider ?? createLlmPlanner({
      config: llmConfig,
      client: options.client !== undefined ? options.client :
        options.clientFactory !== undefined || options.fetchImpl !== undefined ? undefined : inheritedEngine?.client,
      clientFactory: options.clientFactory ?? inheritedEngine?.clientFactory,
      fetchImpl: options.fetchImpl ?? inheritedEngine?.fetchImpl
    }),
    llmConfig
  };
}
