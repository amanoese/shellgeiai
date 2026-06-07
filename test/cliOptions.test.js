import { describe, expect, it } from "vitest";
import { parseCliOptions } from "../src/cliOptions.js";

describe("parseCliOptions", () => {
  it("parses solve options with defaults", () => {
    expect(parseCliOptions(["solve", "CSV", "の", "3列目"])).toEqual({
      command: "solve",
      problem: "CSV の 3列目",
      engine: "mock",
      maxIter: 3
    });
  });

  it("parses explicit engine, max iterations, and workdir", () => {
    expect(parseCliOptions(["solve", "sum", "--engine", "cursor", "--max-iter", "5", "--workdir", "./tmp"])).toEqual({
      command: "solve",
      problem: "sum",
      engine: "cursor",
      maxIter: 5,
      workdir: "./tmp"
    });
  });

  it("rejects an invalid engine", () => {
    expect(() => parseCliOptions(["solve", "sum", "--engine", "bad-engine"])).toThrow(
      "Invalid --engine value. Use mock, codex, or cursor."
    );
  });

  it("rejects a non-positive max iteration count", () => {
    expect(() => parseCliOptions(["solve", "sum", "--max-iter", "0"])).toThrow(
      "Invalid --max-iter value. Use a positive integer."
    );
  });
});
