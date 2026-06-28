import { describe, expect, it } from "vitest";
import { parseCliOptions } from "../src/cliOptions.js";

const DEFAULT_RURI_MODEL = "sirasagi62/ruri-v3-30m-ONNX";
const DEFAULT_RURI_VECTORS =
  "data/knowledge/shellgei-basic.vectors.sirasagi62.ruri-v3-30m-ONNX.json";

function withKnowledgeModelEnv(value, fn) {
  const original = process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
  if (value == null) {
    delete process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
  } else {
    process.env.SHELLGEIAI_KNOWLEDGE_MODEL = value;
  }

  try {
    fn();
  } finally {
    if (original == null) {
      delete process.env.SHELLGEIAI_KNOWLEDGE_MODEL;
    } else {
      process.env.SHELLGEIAI_KNOWLEDGE_MODEL = original;
    }
  }
}

describe("knowledge CLI options", () => {
  it("parses knowledge prepare defaults", () => {
    withKnowledgeModelEnv(null, () => {
      expect(parseCliOptions(["knowledge", "prepare"])).toEqual({
        command: "knowledge-prepare",
        model: DEFAULT_RURI_MODEL
      });
    });
  });

  it("parses knowledge build defaults", () => {
    withKnowledgeModelEnv(null, () => {
      expect(parseCliOptions(["knowledge", "build"])).toEqual({
        command: "knowledge-build",
        datasetPath: "data/knowledge/shellgei-basic.jsonl",
        model: DEFAULT_RURI_MODEL,
        vectorsPath: DEFAULT_RURI_VECTORS
      });
    });
  });

  it("parses knowledge build custom paths", () => {
    expect(
      parseCliOptions([
        "knowledge",
        "build",
        "--knowledge-model",
        "test-model",
        "--dataset",
        "custom.jsonl",
        "--vectors",
        "custom.vectors.json"
      ])
    ).toEqual({
      command: "knowledge-build",
      datasetPath: "custom.jsonl",
      model: "test-model",
      vectorsPath: "custom.vectors.json"
    });
  });

  it("uses selected model in default knowledge build vectors path", () => {
    expect(
      parseCliOptions([
        "knowledge",
        "build",
        "--knowledge-model",
        "owner/custom-model"
      ])
    ).toMatchObject({
      model: "owner/custom-model",
      vectorsPath: "data/knowledge/shellgei-basic.vectors.owner.custom-model.json"
    });
  });

  it("parses knowledge search defaults", () => {
    withKnowledgeModelEnv(null, () => {
      expect(parseCliOptions(["knowledge", "search", "CSV の 3列目"])).toEqual({
        command: "knowledge-search",
        datasetPath: "data/knowledge/shellgei-basic.jsonl",
        model: DEFAULT_RURI_MODEL,
        query: "CSV の 3列目",
        topK: 10,
        vectorsPath: DEFAULT_RURI_VECTORS
      });
    });
  });

  it("parses knowledge search options", () => {
    expect(
      parseCliOptions([
        "knowledge",
        "search",
        "awk",
        "--top-k",
        "3",
        "--knowledge-model",
        "test-model",
        "--dataset",
        "custom.jsonl",
        "--vectors",
        "custom.vectors.json"
      ])
    ).toEqual({
      command: "knowledge-search",
      datasetPath: "custom.jsonl",
      model: "test-model",
      query: "awk",
      topK: 3,
      vectorsPath: "custom.vectors.json"
    });
  });

  it("uses environment knowledge model when no CLI model is provided", () => {
    withKnowledgeModelEnv("env-model", () => {
      expect(parseCliOptions(["knowledge", "build"])).toMatchObject({
        model: "env-model"
      });
    });
  });

  it("lets CLI knowledge model override environment model", () => {
    withKnowledgeModelEnv("env-model", () => {
      expect(
        parseCliOptions([
          "knowledge",
          "prepare",
          "--knowledge-model",
          "cli-model"
        ])
      ).toEqual({
        command: "knowledge-prepare",
        model: "cli-model"
      });
    });
  });

  it("keeps --model as a compatibility alias", () => {
    expect(
      parseCliOptions(["knowledge", "prepare", "--model", "legacy-model"])
    ).toEqual({
      command: "knowledge-prepare",
      model: "legacy-model"
    });
  });

  it("rejects unsupported knowledge subcommands", () => {
    expect(() => parseCliOptions(["knowledge", "download"])).toThrow(
      "Unsupported knowledge subcommand: download"
    );
  });
});
