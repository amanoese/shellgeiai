import { describe, expect, it } from "vitest";
import {
  defaultKnowledgeVectorsPath,
  sanitizeKnowledgeModelForPath
} from "../src/knowledge/vectorFile.js";

describe("knowledge vector file paths", () => {
  it("uses a stable default vectors path next to the dataset", () => {
    expect(
      defaultKnowledgeVectorsPath(
        "data/knowledge/shellgei-basic.jsonl",
        "sirasagi62/ruri-v3-30m-ONNX"
      )
    ).toBe("data/knowledge/shellgei-basic.vectors.json");
  });

  it("sanitizes model names for file paths", () => {
    expect(sanitizeKnowledgeModelForPath("owner/model name@rev")).toBe(
      "owner.model-name-rev"
    );
  });
});
