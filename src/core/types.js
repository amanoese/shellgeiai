/**
 * @typedef {Object} SolveAttempt
 * @property {string} command
 * @property {string} [stdout]
 * @property {string} [stderr]
 * @property {number|null} [exitCode]
 * @property {boolean} [passed]
 * @property {boolean} [timedOut]
 * @property {string} [explanation]
 * @property {string} [failureReason]
 */

/**
 * @typedef {Object} SolveContext
 * @property {string} problem
 * @property {SolveAttempt[]} attempts
 * @property {string} workdir
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
 */

/**
 * @typedef {Object} FinalCheck
 * @property {boolean} passed
 * @property {number} iterations
 * @property {string} engine
 * @property {string} reason
 */

/**
 * @typedef {Object} SolveResult
 * @property {string} command
 * @property {string} output
 * @property {string} explanation
 * @property {SolveAttempt[]} attempts
 * @property {FinalCheck} finalCheck
 * @property {string} workdir
 * @property {ProblemSpec} problem
 * @property {string} logPath
 */

/**
 * @typedef {Object} SolveProblemOptions
 * @property {string} problemInput
 * @property {{name: string, generateCommand(context: SolveContext): Promise<EngineResult>}} engine
 * @property {{run(command: string, options: {cwd: string, timeoutMs: number}): Promise<import("../runner/Runner.js").RunResult>}} runner
 * @property {{judge(input: import("../judge/Judge.js").JudgeInput): Promise<import("../judge/Judge.js").JudgeDecision>}} judge
 * @property {number} maxIterations
 * @property {string} [requestedWorkdir]
 */

/**
 * @typedef {"mock" | "codex" | "cursor"} EngineName
 */

/**
 * @typedef {Object} CliOptions
 * @property {"solve"} command
 * @property {string} problem
 * @property {EngineName} engine
 * @property {number} maxIter
 * @property {string} [workdir]
 */

export {};
