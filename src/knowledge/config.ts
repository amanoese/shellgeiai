import type { KnowledgeMode, KnowledgeRecord, PlannerKnowledgeHint } from "../types.js";
import { createHash } from "node:crypto";
import { homedir as systemHomedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface KnowledgePathOptions { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; homedir?: string | (() => string); inputProfile?: string }
export const MAX_VECTOR_DIMENSIONS = 8192;
export function validateDimensions(dimensions: unknown): asserts dimensions is number {
  if (typeof dimensions !== "number" || !Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > MAX_VECTOR_DIMENSIONS) {
    throw new Error(`Embedding dimensions must be an integer from 1 to ${MAX_VECTOR_DIMENSIONS}.`);
  }
}


export const DEFAULT_KNOWLEDGE_MODEL = "qwen/qwen3-embedding-8b";

export const KNOWLEDGE_MODEL_ENV = "SHELLGEIAI_KNOWLEDGE_MODEL";

export function resolveKnowledgeModel({ model, env = process.env }: { model?: string; env?: NodeJS.ProcessEnv } = {}) {
    return model ?? env[KNOWLEDGE_MODEL_ENV] ?? DEFAULT_KNOWLEDGE_MODEL;
}

export const DEFAULT_KNOWLEDGE_DATASET = fileURLToPath(new URL("../../data/knowledge/shellgei-basic.jsonl", import.meta.url));

export function defaultKnowledgeDbPath(datasetPath = DEFAULT_KNOWLEDGE_DATASET, model = DEFAULT_KNOWLEDGE_MODEL, { env = process.env, platform = process.platform, homedir = systemHomedir, inputProfile = EMBEDDING_INPUT_PROFILE }: KnowledgePathOptions = {}) {
    const home = typeof homedir === "function" ? homedir() : homedir;
    const cache = env.XDG_CACHE_HOME || (platform === "win32" && env.LOCALAPPDATA) || path.join(home, ".cache");
    const fingerprint = createHash("sha256")
        .update(JSON.stringify([path.resolve(datasetPath), "openrouter", model, inputProfile]))
        .digest("hex");
    return path.join(cache, "shellgeiai", "knowledge", `${fingerprint}.sqlite`);
}

export function resolveKnowledgeDbPath({ dbPath, datasetPath = DEFAULT_KNOWLEDGE_DATASET, model = DEFAULT_KNOWLEDGE_MODEL, env = process.env, ...cacheOptions }: KnowledgePathOptions & { dbPath?: string; datasetPath?: string; model?: string } = {}) {
    return dbPath ?? env.SHELLGEIAI_KNOWLEDGE_DB ?? defaultKnowledgeDbPath(datasetPath, model, { env, ...cacheOptions });
}

export const EMBEDDING_INPUT_PROFILE = "qwen-retrieval-v1";

export function formatEmbeddingQuery(text: string) {
    return `Instruct: Given a shell scripting question, retrieve relevant command documentation and examples.\nQuery: ${text}`;
}

export function formatEmbeddingDocument(record: Pick<KnowledgeRecord, "text">) {
    return record.text;
}

export const KNOWLEDGE_MODES = [
    "off",
    "planner",
    "worker",
    "all",
    "on"
] as const;
export const SUPPORTED_KNOWLEDGE_MODES: ReadonlySet<string> = new Set(KNOWLEDGE_MODES);

export function normalizeKnowledgeMode(mode: KnowledgeMode | "on" = "off"): KnowledgeMode {
    return mode === "on" ? "all" : mode;
}

export function usesPlannerKnowledge(mode: KnowledgeMode | "on") {
    const normalizedMode = normalizeKnowledgeMode(mode);
    return normalizedMode === "planner" || normalizedMode === "all";
}

export function usesWorkerKnowledge(mode: KnowledgeMode | "on") {
    const normalizedMode = normalizeKnowledgeMode(mode);
    return normalizedMode === "worker" || normalizedMode === "all";
}

export const MAX_KNOWLEDGE_RESULT_FIELD_CHARS = 300;

export const MAX_KNOWLEDGE_RESULT_TEXT_CHARS = MAX_KNOWLEDGE_RESULT_FIELD_CHARS;

function truncateField(value: unknown) {
    const stringValue = typeof value === "string" ? value : "";
    if (stringValue.length <= MAX_KNOWLEDGE_RESULT_FIELD_CHARS) {
        return stringValue;
    }
    return `${stringValue.slice(0, MAX_KNOWLEDGE_RESULT_FIELD_CHARS)}...`;
}

export function formatKnowledgeRecords(records: readonly PlannerKnowledgeHint[], { limit = 5 } = {}): Required<PlannerKnowledgeHint>[] {
    return records.slice(0, limit).map((record) => ({
        id: truncateField(record.id),
        command: truncateField(record.command),
        option: truncateField(record.option),
        text: truncateField(record.text),
        source: truncateField(record.source)
    }));
}