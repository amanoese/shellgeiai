/**
 * Normalized knowledge execution mode. The CLI alias `on` is normalized to `all`.
 * @typedef {"off" | "planner" | "worker" | "all"} KnowledgeMode
 */

/**
 * Provider-neutral Tool definition exposed to an Engine adapter.
 * @typedef {Object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {Object} parameters
 */

/**
 * Provider-neutral Tool call returned by an Engine adapter.
 * @typedef {Object} EngineToolCall
 * @property {string} id
 * @property {string} name
 * @property {Object} arguments
 */

/**
 * ToolRegistry execution request with provider correlation fields removed.
 * @typedef {Object} ToolExecutionCall
 * @property {string} name
 * @property {Object} arguments
 */

/**
 * Bounded, log-safe summary of a Tool call. Full Tool result values and provider IDs are omitted.
 * @typedef {Object} ToolCallSummary
 * @property {string} name
 * @property {Object} arguments
 * @property {"completed" | "error"} status
 * @property {number} resultCount
 * @property {string[]} recordIds
 */

/**
 * Provider-owned opaque continuation passed unchanged to the next Engine turn.
 * @typedef {Object<string, unknown>} EngineContinuation
 */

/**
 * @typedef {Object} EngineToolResult
 * @property {string} callId
 * @property {unknown} result
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
 * @typedef {Object} SolveAttempt
 * @property {string} [attemptId]
 * @property {string} [workerId]
 * @property {string} command
 * @property {string} [stdout]
 * @property {string} [stderr]
 * @property {number|null} [exitCode]
 * @property {boolean} [passed]
 * @property {boolean} [timedOut]
 * @property {string} [explanation]
 * @property {string} [failureReason]
 * @property {number} [durationMs]
 * @property {import("../../execution/judge/Judge.js").JudgeScore} [score]
 * @property {import("../../execution/runner/Runner.js").RunnerFailure | null} [runnerFailure]
 * @property {import("../../execution/runner/Runner.js").RunnerCleanup | null} [runnerCleanup]
 * @property {ToolCallSummary[]} [toolCalls]
 */

/**
 * @typedef {Object} ToolSuggestion
 * @property {string} summary
 * @property {string} rationale
 * @property {string[]} suggestedTools
 */

/**
 * @typedef {Object} PlanVariant
 * @property {string} variantId
 * @property {string} label
 * @property {string} approach
 * @property {string[]} toolBias
 * @property {string} intent
 * @property {string[]} constraints
 * @property {string[]} avoid
 * @property {string} explorationHint
 * @property {ToolSuggestion[]} [toolSuggestions]
 */

/**
 * @typedef {Object} WorkerTask
 * @property {string} workerId
 * @property {string} strategy
 * @property {{name: string, focus: string, retryHint: string, rubricFocus: string[]}} strategyProfile
 * @property {PlanVariant} [assignedVariant]
 * @property {number} maxAttempts
 */

/**
 * @typedef {Object} SolveContext
 * @property {string} problem
 * @property {SolveAttempt[]} attempts
 * @property {string} workdir
 * @property {string} [workerId]
 * @property {string} [strategy]
 * @property {WorkerTask} [workerTask]
 */

/**
 * @typedef {Object} EngineResult
 * @property {string} command
 * @property {string} [explanation]
 */

/**
 * @typedef {Object} ProblemSpec
 * @property {string} raw
 * @property {string} problemText
 * @property {string} [expectedOutput]
 * @property {{format: string}} [metadata]
 */

/**
 * @typedef {"simple" | "artistry" | "robustness"} ShellgeiScoreMode
 */

/**
 * @typedef {Object} ShellgeiScore
 * @property {number} value
 * @property {ShellgeiScoreMode} mode
 * @property {{conciseness: number, shellness: number, ingenuity: number, readability: number, robustness: number, artistry: number}} breakdown
 * @property {string[]} notes
 * @property {string[]} penalties
 */

/**
 * @typedef {Object} ExecutionPlan
 * @property {"single" | "parallel"} mode
 * @property {number} parallelism
 * @property {PlanVariant[]} variants
 * @property {WorkerTask[]} workerTasks
 * @property {KnowledgeMode} [knowledgeMode]
 * @property {{provider: string, attemptedProvider: string|null, fallbackReason: string|null, promptVersion: string|null, prompt: string|null, rawResponse: string|null}} planner
 */

/**
 * Retrieved knowledge record made available only to the Planner prefetch boundary.
 * @typedef {Object} PlannerKnowledgeHint
 * @property {string} [id]
 * @property {string} [command]
 * @property {string} [option]
 * @property {string} [text]
 * @property {string} [source]
 */

/**
 * Tool implementation registered with the provider-neutral ToolRegistry.
 * @typedef {Object} ToolRegistration
 * @property {string} name
 * @property {string} description
 * @property {import("zod").ZodType} inputSchema
 * @property {(input: Object) => unknown | Promise<unknown>} execute
 */

/**
 * Provider-neutral Tool execution boundary owned by solve orchestration.
 * @typedef {Object} ToolRegistry
 * @property {(tool: ToolRegistration) => void} register
 * @property {() => ToolDefinition[]} definitions
 * @property {(call: ToolExecutionCall) => Promise<{ok: boolean, value?: unknown, error?: {code: string, message: string}, validatedArguments: Object}>} execute
 */

/**
 * @typedef {Object} KnowledgeRetriever
 * @property {(input: {problem: string, expectedOutput?: string}) => Promise<PlannerKnowledgeHint[]>} [retrieveForPlanner]
 * @property {(input: {query: string}) => Promise<PlannerKnowledgeHint[]>} [search]
 */

/**
 * @typedef {Object} KnowledgeEmbedder
 * @property {(text: string) => Promise<number[]>} embed
 */

/**
 * @typedef {(options: {model: string}) => KnowledgeEmbedder} KnowledgeEmbedderFactory
 */

/**
 * Session fields consumed by Planner providers and knowledge-enabled Worker orchestration.
 * @typedef {Object} SolveSession
 * @property {ProblemSpec} problem
 * @property {"single" | "parallel"} mode
 * @property {number} parallelism
 * @property {number} maxIterations
 * @property {KnowledgeMode} knowledgeMode
 * @property {PlannerKnowledgeHint[]} plannerKnowledgeHints
 * @property {KnowledgeRetriever} [knowledgeRetriever]
 * @property {ToolRegistry} [toolRegistry]
 * @property {ExecutionPlan} [plan]
 */

/**
 * Engines declaring `capabilities.toolCalling: true` must implement `generateTurn`.
 * Engines without Tool Calling support may omit both the capability and method.
 *
 * @typedef {Object} SolveProblemOptions
 * @property {string} problemInput
 * @property {{name: string, capabilities?: {toolCalling: boolean}, generateCommand(context: SolveContext): Promise<EngineResult>, generateTurn?(input: {context: SolveContext, tools: ToolDefinition[], continuation?: EngineContinuation, toolResults?: EngineToolResult[]}): Promise<CommandTurn | ToolCallsTurn>}} engine
 * @property {{name?: string, run(command: string, options: import("../../execution/runner/Runner.js").RunOptions): Promise<import("../../execution/runner/Runner.js").RunResult>}} runner
 * @property {{judge(input: import("../../execution/judge/Judge.js").JudgeInput): Promise<import("../../execution/judge/Judge.js").JudgeDecision>}} judge
 * @property {number} maxIterations
 * @property {string} [requestedWorkdir]
 * @property {"single" | "parallel"} [mode]
 * @property {number} [parallelism]
 * @property {"first-pass-wins" | "best-score-wins"} [selector]
 * @property {number} [timeBudgetMs]
 * @property {boolean} [writableWorkdir]
 * @property {ShellgeiScoreMode} [shellgeiScoreMode]
 * @property {import("../../execution/runner/Runner.js").RunnerLimits} [runnerLimits]
 * @property {{blockedCommands: {name: string, reason: string}[], blockedRedirectionTargets: {prefix: string, reason: string}[], blockRecursiveBackgroundFunctions: boolean}} [commandPolicy]
 * @property {string} [commandPolicyPath]
 * @property {import("../../execution/runner/Runner.js").SandboxPolicy} [sandboxPolicy]
 * @property {string} [sandboxPolicyPath]
 * @property {KnowledgeMode | "on"} [knowledgeMode]
 * @property {string} [knowledgeModel]
 * @property {string} [knowledgeDatasetPath]
 * @property {string} [knowledgeVectorsPath]
 * @property {KnowledgeRetriever} [knowledgeRetriever]
 * @property {KnowledgeEmbedder} [knowledgeEmbedder]
 * @property {KnowledgeEmbedderFactory} [knowledgeEmbedderFactory]
 * @property {(event: SolveProgressEvent) => void} [onProgress]
 * @property {{name?: string, buildPlan(session: SolveSession): Promise<unknown>}} [plannerProvider]
 */

/**
 * @typedef {Object} SolveProgressEvent
 * @property {"session-started" | "worker-started" | "worker-state" | "attempt-started" | "attempt-finished" | "session-finished"} type
 */

export {};
