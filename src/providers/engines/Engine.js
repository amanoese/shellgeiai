/**
 * @typedef {Object} EngineCapabilities
 * @property {boolean} toolCalling
 */

/**
 * @typedef {Object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {Object} parameters
 */

/**
 * @typedef {Object} EngineToolCall
 * @property {string} id
 * @property {string} name
 * @property {Object} arguments
 */

/**
 * Provider-owned opaque continuation state passed unchanged to a subsequent turn.
 * @typedef {Object<string, unknown>} EngineContinuation
 */

/**
 * @typedef {Object} EngineToolResult
 * @property {string} callId
 * @property {unknown} result
 */

/**
 * @typedef {Object} GenerateTurnInput
 * @property {import("../../solve/session/types.js").SolveContext} context
 * @property {ToolDefinition[]} tools
 * @property {EngineContinuation} [continuation]
 * @property {EngineToolResult[]} [toolResults]
 */

/**
 * @typedef {Object} CommandTurn
 * @property {"command"} type
 * @property {string} command
 * @property {string} [explanation]
 */

/**
 * @typedef {Object} ToolCallsTurn
 * @property {"tool_calls"} type
 * @property {EngineToolCall[]} calls
 * @property {EngineContinuation} continuation
 */

/**
 * @typedef {CommandTurn | ToolCallsTurn} EngineTurn
 */

/**
 * @typedef {Object} Engine
 * @property {string} name
 * @property {EngineCapabilities} [capabilities]
 * @property {(context: import("../../solve/session/types.js").SolveContext) => Promise<import("../../solve/session/types.js").EngineResult>} generateCommand
 * @property {(input: GenerateTurnInput) => Promise<EngineTurn>} [generateTurn]
 */

export {};
