import { describe, expect, it } from "vitest";

import { CodexCliEngine } from "../dist/providers/engines.js";
import { CursorCliEngine } from "../dist/providers/engines.js";
import { MockEngine } from "../dist/providers/engines.js";

describe("engine capabilities", () => {
  it.each([
    ["mock", new MockEngine()],
    ["Codex CLI", new CodexCliEngine({ command: "test-codex", args: ["exec"] })],
    ["Cursor CLI", new CursorCliEngine()]
  ])("declares that the %s engine does not support tool calling", (_name, engine) => {
    expect(engine.capabilities).toEqual({ toolCalling: false });
  });
});
