import type { KnowledgeMode, KnowledgeSnapshot, KnowledgeStore, KnowledgeVector, ToolRegistration } from "../../src/types.js";
import { createKnowledgeRuntime, createSearchKnowledgeTool, searchKnowledgeInputSchema } from "../../src/knowledge/runtime.js";
import type { SearchKnowledgeInput } from "../../src/knowledge/runtime.js";
import { normalizeKnowledgeRecord } from "../../src/knowledge/dataset.js";
import { z } from "zod";

const vector: KnowledgeVector = new Float32Array([1, 0]);
// @ts-expect-error Vectors cannot carry nonnumeric values.
const invalidVector: KnowledgeVector = ["1", "0"];
const mode: KnowledgeMode = "worker";
// @ts-expect-error `on` is an input alias, never a normalized runtime mode.
const alias: KnowledgeMode = "on";
const record = normalizeKnowledgeRecord(JSON.parse('{"id":"x"}'));
const text: string = record.text;
declare const store: KnowledgeStore;
store.search({ generationId: 1, vector });
// @ts-expect-error Search must explicitly pin a generation.
store.search({ vector });
const tool = createSearchKnowledgeTool({ retriever: { search: async () => [record] } });
const registration: ToolRegistration<SearchKnowledgeInput> = tool;
const sameSchema: typeof searchKnowledgeInputSchema = tool.inputSchema;
// @ts-expect-error Search schema and execute input must agree.
const invalidSchema: ToolRegistration<SearchKnowledgeInput> = { ...tool, inputSchema: z.object({ query: z.number() }) };
// @ts-expect-error Parsed search inputs require string queries.
tool.execute({ query: 4 });
async function knowledgeBoundaryContracts() {
  const result = await tool.execute({ query: "awk" });
  const id: string = result.records[0].id;
  // @ts-expect-error Public tool summaries allowlist fields and do not expose vector distance.
  result.records[0].distance;
  const runtime = await createKnowledgeRuntime();
  const snapshot: KnowledgeSnapshot = runtime.snapshot;
  const hits = await runtime.search({ query: "awk" });
  const score: number = hits[0].score;
  // @ts-expect-error Dataset fingerprints are required to pin the selected snapshot.
  const incompleteSnapshot: KnowledgeSnapshot = { provider: "openrouter", model: "m", inputProfile: "p", dbPath: "x", dimensions: 2, generationId: 1 };
  return [id, snapshot, score, incompleteSnapshot];
}
void [vector, invalidVector, mode, alias, text, registration, sameSchema, invalidSchema, knowledgeBoundaryContracts];
