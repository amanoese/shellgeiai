import { describe, expect, it } from "vitest";
import { parseCliOptions } from "../src/cliOptions.js";

describe("knowledge CLI options", () => {
  it("parses knowledge prepare defaults", () => {
    expect(parseCliOptions(["knowledge", "prepare"])).toEqual({
      command: "knowledge-prepare",
      model: "Xenova/multilingual-e5-small"
    });
  });

  it("parses knowledge build defaults", () => {
    expect(parseCliOptions(["knowledge", "build"])).toEqual({
      command: "knowledge-build",
      datasetPath: "data/knowledge/shellgei-basic.jsonl",
      model: "Xenova/multilingual-e5-small",
      vectorsPath: "data/knowledge/shellgei-basic.vectors.json"
    });
  });

  it("parses knowledge build custom paths", () => {
    expect(
      parseCliOptions([
        "knowledge",
        "build",
        "--model",
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

  it("rejects unsupported knowledge subcommands", () => {
    expect(() => parseCliOptions(["knowledge", "download"])).toThrow(
      "Unsupported knowledge subcommand: download"
    );
  });
});
