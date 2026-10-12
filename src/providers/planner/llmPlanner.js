import { zodTextFormat } from "openai/helpers/zod";
import { resolveLlmConfig } from "../llm/config.js";
import { createLlmClient, safeLlmError } from "../llm/client.js";

import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  PLANNER_PROMPT_VERSION
} from "./plannerPrompt.js";
import { plannerResultSchema } from "./plannerSchema.js";

async function requestPlan(session, client, config) {
  session.signal?.throwIfAborted();
  const prompt = buildPlannerUserPrompt(session);
  const model = config.plannerModel;
  let response;
  try {
    response = await client.responses.parse({
      model,
      store: false,
      ...(["openai/gpt-6.1-sol", "gpt-6.1-sol"].includes(model)
        ? { include: ["reasoning.encrypted_content"] } : {}),
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: buildPlannerSystemPrompt() }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      ],
      text: {
        format: zodTextFormat(plannerResultSchema, "shellgeiai_planner_plan")
      }
    }, { signal: session.signal });
  } catch (error) {
    if (error instanceof SyntaxError || error?.name === "ZodError") {
      throw new Error("The planner model returned invalid structured output.");
    }
    throw safeLlmError(error);
  }
  session.signal?.throwIfAborted();

  if (response?.status != null && response.status !== "completed") {
    throw new Error("The planner model returned a non-completed response.");
  }
  if (Array.isArray(response?.output) && response.output.some(item =>
    Array.isArray(item?.content) && item.content.some(content => content?.type === "refusal"))) {
    throw new Error("The planner model refused to produce a plan.");
  }

  if (!response?.output_parsed) {
    throw new Error("The planner model returned no parsed structured output.");
  }
  const parsed = plannerResultSchema.safeParse(response.output_parsed);
  if (!parsed.success) {
    throw new Error("The planner model returned invalid structured output.");
  }

  return {
    ...parsed.data,
    promptVersion: PLANNER_PROMPT_VERSION,
    prompt,
    rawResponse: response.output_text ?? null
  };
}

/** A configured Planner owns one lazy SDK client; it never falls back on schema failure. */
export function createLlmPlanner({ config, client, clientFactory = createLlmClient, fetchImpl } = {}) {
  const llmConfig = config ?? resolveLlmConfig(client ? { apiKey: "injected-client" } : {});
  let clientPromise;
  return {
    name: "llm",
    async buildPlan(session) {
      session.signal?.throwIfAborted();
      clientPromise ??= client ? Promise.resolve(client) : Promise.resolve().then(() => clientFactory({
        apiKey: llmConfig.apiKey,
        baseURL: llmConfig.baseURL,
        timeoutMs: llmConfig.timeoutMs,
        maxRetries: llmConfig.maxRetries,
        ...(fetchImpl === undefined ? {} : { fetchImpl })
      }));
      return requestPlan(session, await clientPromise, llmConfig);
    }
  };
}

/** Compatibility entry point: options.model is an explicit Planner model override. */
export async function buildLlmPlan(session, options = {}) {
  const config = options.config
    ? { ...options.config, plannerModel: options.model ?? options.config.plannerModel }
    : resolveLlmConfig({ ...options,
        ...(options.client && options.apiKey === undefined ? { apiKey: "injected-client" } : {}),
        plannerModel: options.model ?? options.plannerModel });
  return createLlmPlanner({ ...options, config }).buildPlan(session);
}

export const llmPlanner = {
  name: "llm",
  async buildPlan(session) {
    return buildLlmPlan(session);
  }
};

export default llmPlanner;
