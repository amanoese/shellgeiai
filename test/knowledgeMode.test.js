import { describe, expect, it } from "vitest";

import {
  normalizeKnowledgeMode,
  usesPlannerKnowledge,
  usesWorkerKnowledge
} from "../src/knowledge/mode.js";

describe("knowledge modes", () => {
  it.each([
    ["off", "off", false, false],
    ["planner", "planner", true, false],
    ["worker", "worker", false, true],
    ["all", "all", true, true],
    ["on", "all", true, true]
  ])(
    "%s normalizes to %s and selects the expected consumers",
    (mode, normalizedMode, planner, worker) => {
      expect(normalizeKnowledgeMode(mode)).toBe(normalizedMode);
      expect(usesPlannerKnowledge(mode)).toBe(planner);
      expect(usesWorkerKnowledge(mode)).toBe(worker);
    }
  );
});
