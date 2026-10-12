import type OpenAI from "openai";
import type { Engine, Runner, Judge, LlmClient, KnowledgeEmbedder, PlannerProvider } from "../../src/types.js";
import { DockerRunner } from "../../src/execution/dockerRunner.js";
import { LocalRunner } from "../../src/execution/localRunner.js";
import { SimpleJudge } from "../../src/execution/judge.js";
import { OpenAIEngine } from "../../src/providers/apiEngine.js";
import { MockEngine, CodexCliEngine, CursorCliEngine } from "../../src/providers/engines.js";
import { createLlmClient, requestLlmResponse } from "../../src/providers/llm.js";
import { createLlmPlanner } from "../../src/providers/planner.js";
import { createOpenRouterEmbedder } from "../../src/providers/embedder.js";

declare const sdk: OpenAI;
const client: LlmClient = sdk;
const api: Engine = new OpenAIEngine({ client });
const engines: Engine[] = [api, new MockEngine(), new CodexCliEngine(), new CursorCliEngine()];
const runners: Runner[] = [new DockerRunner(), new LocalRunner()];
const judge: Judge = new SimpleJudge();
const planner: PlannerProvider = createLlmPlanner({ client });
const embedder: KnowledgeEmbedder = createOpenRouterEmbedder();

async function sdkBoundaryContracts() {
  const created: OpenAI = await createLlmClient({ apiKey: "test", baseURL: "https://example.invalid/v1", timeoutMs: 1000, maxRetries: 0 });
  created.withOptions({ timeout: 2000 });
  await requestLlmResponse(client, { model: "test", input: "hello", store: false });
  // @ts-expect-error The nonstreaming engine boundary cannot receive a stream.
  await requestLlmResponse(client, { model: "test", input: "hello", stream: true });
  // @ts-expect-error SDK request content type identifiers are checked.
  await requestLlmResponse(client, { model: "test", input: [{ role: "user", content: [{ type: "invalid_text", text: "hello" }] }] });
  const response = await requestLlmResponse(client, { model: "test", input: "hello" });
  // @ts-expect-error The response boundary retains SDK status types.
  const status: "arbitrary" = response.status;
  return status;
}
void [engines, runners, judge, planner, embedder, sdkBoundaryContracts];
