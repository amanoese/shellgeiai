import { createHash } from "node:crypto";
import { homedir as systemHomedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EMBEDDING_INPUT_PROFILE } from "./embeddingInputs.js";
import { DEFAULT_KNOWLEDGE_MODEL } from "./modelConfig.js";

export const DEFAULT_KNOWLEDGE_DATASET = fileURLToPath(
  new URL("../../data/knowledge/shellgei-basic.jsonl", import.meta.url)
);

export function defaultKnowledgeDbPath(datasetPath = DEFAULT_KNOWLEDGE_DATASET, model = DEFAULT_KNOWLEDGE_MODEL, {
  env = process.env,
  platform = process.platform,
  homedir = systemHomedir,
  inputProfile = EMBEDDING_INPUT_PROFILE
} = {}) {
  const home = typeof homedir === "function" ? homedir() : homedir;
  const cache = env.XDG_CACHE_HOME || (platform === "win32" && env.LOCALAPPDATA) || path.join(home, ".cache");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([path.resolve(datasetPath), "openrouter", model, inputProfile]))
    .digest("hex");
  return path.join(cache, "shellgeiai", "knowledge", `${fingerprint}.sqlite`);
}

export function resolveKnowledgeDbPath({
  dbPath,
  datasetPath = DEFAULT_KNOWLEDGE_DATASET,
  model = DEFAULT_KNOWLEDGE_MODEL,
  env = process.env,
  ...cacheOptions
} = {}) {
  return dbPath ?? env.SHELLGEIAI_KNOWLEDGE_DB ?? defaultKnowledgeDbPath(datasetPath, model, { env, ...cacheOptions });
}
