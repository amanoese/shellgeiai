import { existsSync } from "node:fs";
import { expect, test } from "vitest";

test("execution and provider implementations are consolidated TypeScript modules", () => {
  for (const name of ["execution/dockerRunner", "execution/localRunner", "execution/safety", "execution/judge", "providers/llm", "providers/apiEngine", "providers/engines", "providers/planner", "providers/embedder"]) {
    expect(existsSync(new URL(`../src/${name}.ts`, import.meta.url))).toBe(true);
  }
});
