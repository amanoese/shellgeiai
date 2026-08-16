import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createToolRegistry } from "../src/tools/toolRegistry.js";

function echoTool(overrides = {}) {
  return {
    name: "echo_value",
    description: "Echo one value.",
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    execute: async ({ value }) => ({ value }),
    ...overrides
  };
}

describe("createToolRegistry", () => {
  it("returns provider definitions in registration order without runtime internals", () => {
    const registry = createToolRegistry();
    registry.register(echoTool());
    registry.register(
      echoTool({
        name: "second_tool",
        description: "A second tool."
      })
    );

    const definitions = registry.definitions();

    expect(definitions).toEqual([
      {
        name: "echo_value",
        description: "Echo one value.",
        parameters: {
          type: "object",
          properties: {
            value: { type: "string", minLength: 1 }
          },
          required: ["value"],
          additionalProperties: false
        }
      },
      {
        name: "second_tool",
        description: "A second tool.",
        parameters: {
          type: "object",
          properties: {
            value: { type: "string", minLength: 1 }
          },
          required: ["value"],
          additionalProperties: false
        }
      }
    ]);
    expect(definitions[0]).not.toHaveProperty("inputSchema");
    expect(definitions[0]).not.toHaveProperty("execute");
    expect(definitions[0].parameters).not.toHaveProperty("$schema");
  });

  it("returns a sanitized result for an unknown tool", async () => {
    const registry = createToolRegistry();

    await expect(registry.execute({ name: "missing", arguments: { value: "ok" } })).resolves.toEqual({
      ok: false,
      error: {
        code: "unknown_tool",
        message: "Unknown Tool: missing"
      },
      validatedArguments: {}
    });
  });

  it("returns a sanitized result for invalid arguments", async () => {
    const registry = createToolRegistry();
    registry.register(echoTool());

    await expect(
      registry.execute({ name: "echo_value", arguments: { value: "", extra: true } })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_arguments",
        message: "Invalid arguments for Tool echo_value."
      },
      validatedArguments: {}
    });
  });

  it("awaits execution and returns the parsed arguments", async () => {
    const registry = createToolRegistry();
    registry.register(
      echoTool({
        execute: async ({ value }) => ({ echoed: value })
      })
    );

    await expect(registry.execute({ name: "echo_value", arguments: { value: "ok" } })).resolves.toEqual({
      ok: true,
      value: { echoed: "ok" },
      validatedArguments: { value: "ok" }
    });
  });

  it("completely sanitizes execution failures", async () => {
    const registry = createToolRegistry();
    registry.register(
      echoTool({
        execute: async () => {
          throw new Error("secret /tmp/path");
        }
      })
    );

    const result = await registry.execute({ name: "echo_value", arguments: { value: "ok" } });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "tool_execution_failed",
        message: "Tool echo_value failed."
      },
      validatedArguments: { value: "ok" }
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("/tmp/path");
  });

  it.each([
    ["empty name", { name: "" }],
    ["empty description", { description: "" }],
    ["missing input schema", { inputSchema: undefined }],
    ["schema without safeParse", { inputSchema: {} }],
    ["non-function execute", { execute: null }]
  ])("rejects registration with %s", (_label, overrides) => {
    const registry = createToolRegistry();

    expect(() => registry.register(echoTool(overrides))).toThrow();
  });

  it("rejects a non-Zod safeParse impostor during registration", () => {
    const registry = createToolRegistry();
    const inputSchema = {
      safeParse(value) {
        return { success: true, data: value };
      }
    };

    expect(() => registry.register(echoTool({ inputSchema }))).toThrow(
      new TypeError("Tool inputSchema must support safeParse.")
    );
  });

  it("rejects duplicate tool names with the required message", () => {
    const registry = createToolRegistry();
    registry.register(echoTool());

    expect(() => registry.register(echoTool())).toThrow("Tool already registered: echo_value");
  });
});
