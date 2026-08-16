import { describe, expect, it } from "vitest";

import { CodexCliEngine } from "../src/providers/engines/codexCliEngine.js";
import { CursorCliEngine } from "../src/providers/engines/cursorCliEngine.js";
import { MockEngine } from "../src/providers/engines/mockEngine.js";

describe("engine capabilities", () => {
  it.each([
    ["mock", new MockEngine()],
    ["Codex CLI", new CodexCliEngine({ command: "test-codex", args: ["exec"] })],
    ["Cursor CLI", new CursorCliEngine()]
  ])("declares that the %s engine does not support tool calling", (_name, engine) => {
    expect(engine.capabilities).toEqual({ toolCalling: false });
  });
});
