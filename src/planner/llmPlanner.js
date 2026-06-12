import { zodTextFormat } from "openai/helpers/zod";
import { buildPlannerSystemPrompt, buildPlannerUserPrompt, PLANNER_PROMPT_VERSION } from "./plannerPrompt.js";
import { plannerResultSchema } from "./plannerSchema.js";

async function createDefaultClient(options) {
  let OpenAI;

  try {
    ({ default: OpenAI } = await import("openai"));
  } catch {
    throw new Error("The 'openai' package is not installed. Run 'npm install' and try again.");
  }

  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: options.timeoutMs,
    maxRetries: options.maxRetries
  });
}

export async function buildLlmPlan(session, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set for the LLM planner.");
  }

  const clientFactory = options.clientFactory ?? createDefaultClient;
  const client =
    options.client ??
    (await clientFactory({
      apiKey,
      baseURL: options.baseURL ?? process.env.OPENAI_BASE_URL,
      timeoutMs: options.timeoutMs ?? 10_000,
      maxRetries: options.maxRetries ?? 2
    }));
  const prompt = buildPlannerUserPrompt(session);
  const response = await client.responses.parse({
    model: options.model ?? process.env.OPENAI_PLANNER_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
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
  });

  if (!response.output_parsed) {
    throw new Error("The planner model returned no parsed structured output.");
  }

  return {
    ...response.output_parsed,
    promptVersion: PLANNER_PROMPT_VERSION,
    prompt,
    rawResponse: null
  };
}

export const llmPlanner = {
  name: "llm",
  buildPlan: buildLlmPlan
};
