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
 * @property {{provider: string, attemptedProvider: string|null, fallbackReason: string|null, promptVersion: string|null, prompt: string|null, rawResponse: string|null}} planner
 */

/**
 * @typedef {Object} SolveProblemOptions
 * @property {string} problemInput
 * @property {{name: string, generateCommand(context: SolveContext): Promise<EngineResult>}} engine
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
 * @property {{blockedPatterns: {pattern: RegExp, reason: string}[]}} [commandPolicy]
 * @property {string} [commandPolicyPath]
 * @property {import("../../execution/runner/Runner.js").SandboxPolicy} [sandboxPolicy]
 * @property {string} [sandboxPolicyPath]
 * @property {(event: SolveProgressEvent) => void} [onProgress]
 * @property {{name?: string, buildPlan(session: unknown): Promise<unknown>}} [plannerProvider]
 */

/**
 * @typedef {Object} SolveProgressEvent
 * @property {"session-started" | "worker-started" | "worker-state" | "attempt-started" | "attempt-finished" | "session-finished"} type
 */

export {};
