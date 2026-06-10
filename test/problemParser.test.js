import { describe, expect, it } from "vitest";
import { parseProblemInput } from "../src/problem/parseProblem.js";

describe("parseProblemInput", () => {
  it("keeps plain text input compatible with the previous behavior", () => {
    expect(parseProblemInput("CSVの3列目の合計を出してください")).toEqual({
      raw: "CSVの3列目の合計を出してください",
      problemText: "CSVの3列目の合計を出してください",
      metadata: {
        format: "plain-text"
      }
    });
  });
});
