import { z } from "zod";

function validateTool(tool) {
  if (typeof tool?.name !== "string" || tool.name.trim().length === 0) {
    throw new TypeError("Tool name must be a non-empty string.");
  }
  if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
    throw new TypeError("Tool description must be a non-empty string.");
  }
  if (typeof tool.inputSchema?.safeParse !== "function") {
    throw new TypeError("Tool inputSchema must support safeParse.");
  }
  if (typeof tool.execute !== "function") {
    throw new TypeError("Tool execute must be a function.");
  }
}

export function createToolRegistry() {
  const tools = new Map();

  return {
    register(tool) {
      validateTool(tool);
      if (tools.has(tool.name)) {
        throw new Error(`Tool already registered: ${tool.name}`);
      }
      tools.set(tool.name, tool);
    },

    definitions() {
      return Array.from(tools.values(), ({ name, description, inputSchema }) => {
        const { $schema: _schema, ...parameters } = z.toJSONSchema(inputSchema);
        return { name, description, parameters };
      });
    },

    async execute({ name, arguments: argumentsValue }) {
      const tool = tools.get(name);
      if (!tool) {
        return {
          ok: false,
          error: {
            code: "unknown_tool",
            message: `Unknown Tool: ${name}`
          },
          validatedArguments: {}
        };
      }

      const parsed = tool.inputSchema.safeParse(argumentsValue);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "invalid_arguments",
            message: `Invalid arguments for Tool ${name}.`
          },
          validatedArguments: {}
        };
      }

      try {
        const value = await tool.execute(parsed.data);
        return {
          ok: true,
          value,
          validatedArguments: parsed.data
        };
      } catch {
        return {
          ok: false,
          error: {
            code: "tool_execution_failed",
            message: `Tool ${name} failed.`
          },
          validatedArguments: parsed.data
        };
      }
    }
  };
}
