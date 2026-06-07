import { describe, expect, it } from "vitest";
import { isSafeCommand } from "../src/runner/safety.js";

describe("isSafeCommand", () => {
  it("allows a simple awk command", () => {
    expect(isSafeCommand("awk -F, '{s+=$3} END{print s}' sample.csv")).toEqual({ safe: true });
  });

  it("blocks dangerous commands", () => {
    expect(isSafeCommand("rm -rf /tmp/work")).toEqual({
      safe: false,
      reason: "Blocked dangerous command: rm"
    });
  });
});
