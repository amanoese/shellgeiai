import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_KNOWLEDGE_MODEL, resolveKnowledgeModel } from "../dist/knowledge/modelConfig.js";
import * as inputs from "../dist/knowledge/embeddingInputs.js";
import * as paths from "../dist/knowledge/knowledgePaths.js";

describe("knowledge embedding configuration", () => {
  it("defaults to Qwen and gives explicit model priority over the environment", () => {
    expect(DEFAULT_KNOWLEDGE_MODEL).toBe("qwen/qwen3-embedding-8b");
    expect(resolveKnowledgeModel({ env: {} })).toBe(DEFAULT_KNOWLEDGE_MODEL);
    expect(resolveKnowledgeModel({ env: { SHELLGEIAI_KNOWLEDGE_MODEL: "env-model" } })).toBe("env-model");
    expect(resolveKnowledgeModel({ model: "cli-model", env: { SHELLGEIAI_KNOWLEDGE_MODEL: "env-model" } })).toBe("cli-model");
  });

  it("uses the Qwen retrieval instruction only for queries", () => {
    expect(inputs.EMBEDDING_INPUT_PROFILE).toBe("qwen-retrieval-v1");
    expect(inputs.formatEmbeddingQuery("CSV 列を集計")).toBe("Instruct: Given a shell scripting question, retrieve relevant command documentation and examples.\nQuery: CSV 列を集計");
    expect(inputs.formatEmbeddingDocument({ text: "awk '{sum += $1}'" })).toBe("awk '{sum += $1}'");
  });
});

describe("knowledge database paths", () => {
  const dataset = path.resolve("data/example.jsonl");
  const fingerprint = (model = DEFAULT_KNOWLEDGE_MODEL, profile = "qwen-retrieval-v1") => createHash("sha256")
    .update(JSON.stringify([dataset, "openrouter", model, profile])).digest("hex");

  it("resolves the bundled dataset from the package rather than cwd", () => {
    expect(paths.DEFAULT_KNOWLEDGE_DATASET).toBe(fileURLToPath(new URL("../data/knowledge/shellgei-basic.jsonl", import.meta.url)));
  });

  it("uses XDG cache and hashes canonical dataset, provider, model and profile", () => {
    expect(paths.defaultKnowledgeDbPath("data/example.jsonl", DEFAULT_KNOWLEDGE_MODEL, {
      env: { XDG_CACHE_HOME: "/cache", LOCALAPPDATA: "/local" }, platform: "win32", homedir: "/home/test"
    })).toBe(path.join("/cache", "shellgeiai", "knowledge", `${fingerprint()}.sqlite`));
    expect(paths.defaultKnowledgeDbPath(dataset, "other", { env: {}, homedir: "/home/test", inputProfile: "other-profile" }))
      .toBe(path.join("/home/test", ".cache", "shellgeiai", "knowledge", `${fingerprint("other", "other-profile")}.sqlite`));
  });

  it("uses Windows local app data or the home cache fallback", () => {
    expect(paths.defaultKnowledgeDbPath(dataset, DEFAULT_KNOWLEDGE_MODEL, { env: { LOCALAPPDATA: "/local" }, platform: "win32", homedir: "/home/test" }))
      .toBe(path.join("/local", "shellgeiai", "knowledge", `${fingerprint()}.sqlite`));
    expect(paths.defaultKnowledgeDbPath(dataset, DEFAULT_KNOWLEDGE_MODEL, { env: { LOCALAPPDATA: "/local" }, platform: "linux", homedir: "/home/test" }))
      .toBe(path.join("/home/test", ".cache", "shellgeiai", "knowledge", `${fingerprint()}.sqlite`));
  });

  it("resolves CLI then environment then default database location", () => {
    expect(paths.resolveKnowledgeDbPath({ dbPath: "cli.sqlite", env: { SHELLGEIAI_KNOWLEDGE_DB: "env.sqlite" } })).toBe("cli.sqlite");
    expect(paths.resolveKnowledgeDbPath({ env: { SHELLGEIAI_KNOWLEDGE_DB: "env.sqlite" } })).toBe("env.sqlite");
    expect(paths.resolveKnowledgeDbPath({ datasetPath: dataset, env: {}, homedir: "/home/test" }))
      .toBe(path.join("/home/test", ".cache", "shellgeiai", "knowledge", `${fingerprint()}.sqlite`));
  });
});
