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
 * @property {import("../judge/Judge.js").JudgeScore} [score]
 */

/**
 * @typedef {Object} SolveContext
 * @property {string} problem
 * @property {SolveAttempt[]} attempts
 * @property {string} workdir
 * @property {string} [workerId]
 * @property {string} [strategy]
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
 * @typedef {Object} FinalCheck
 * @property {boolean} passed
 * @property {number} iterations
 * @property {string} engine
 * @property {string} reason
 * @property {import("../judge/Judge.js").JudgeScore} [score]
 */

/**
 * @typedef {Object} WorkerTask
 * @property {string} workerId
 * @property {string} strategy
 * @property {number} maxAttempts
 */

/**
 * @typedef {Object} ExecutionPlan
 * @property {string} mode
 * @property {number} parallelism
 * @property {WorkerTask[]} workerTasks
 */

/**
 * @typedef {Object} SolveCandidate
 * @property {string} candidateId
 * @property {string} workerId
 * @property {string} [strategy]
 * @property {string} command
 * @property {string} output
 * @property {string} explanation
 * @property {SolveAttempt[]} attempts
 * @property {FinalCheck} finalCheck
 */

/**
 * @typedef {Object} SolveResult
 * @property {string} command
 * @property {string} output
 * @property {string} explanation
 * @property {SolveAttempt[]} attempts
 * @property {SolveCandidate[]} candidates
 * @property {FinalCheck} finalCheck
 * @property {{name: string, reason: string, selectedCandidateId?: string|null, score?: import("../judge/Judge.js").JudgeScore|null, metrics?: {totalScore: number, judgeScore: number, stdoutConsistency: number, outputConsensus: number, totalDurationMs: number, iterationCount: number, commandLength: number, explanationLength: number}|null}} selector
 * @property {{name: string, limits: import("../runner/Runner.js").RunnerLimits, sandboxPolicy: import("../runner/Runner.js").SandboxPolicy}} runner
 * @property {string|null} [stopReason]
 * @property {string} workdir
 * @property {ProblemSpec} problem
 * @property {string} logPath
 * @property {ExecutionPlan} [plan]
 */

/**
 * @typedef {Object} SolveProblemOptions
 * @property {string} problemInput
 * @property {{name: string, generateCommand(context: SolveContext): Promise<EngineResult>}} engine
 * @property {{name?: string, run(command: string, options: import("../runner/Runner.js").RunOptions): Promise<import("../runner/Runner.js").RunResult>}} runner
 * @property {{judge(input: import("../judge/Judge.js").JudgeInput): Promise<import("../judge/Judge.js").JudgeDecision>}} judge
 * @property {number} maxIterations
 * @property {string} [requestedWorkdir]
 * @property {"single" | "parallel"} [mode]
 * @property {number} [parallelism]
 * @property {"first-pass-wins" | "best-score-wins"} [selector]
 * @property {number} [timeBudgetMs]
 * @property {import("../runner/Runner.js").RunnerLimits} [runnerLimits]
 * @property {{blockedPatterns: {pattern: RegExp, reason: string}[]}} [commandPolicy]
 * @property {string} [commandPolicyPath]
 * @property {import("../runner/Runner.js").SandboxPolicy} [sandboxPolicy]
 * @property {string} [sandboxPolicyPath]
 */

/**
 * @typedef {"openai" | "mock"} EngineName
 */

/**
 * @typedef {Object} CliOptions
 * @property {"solve"} command
 * @property {string} problem
 * @property {EngineName} engine
 * @property {"local" | "docker"} [runner]
 * @property {number} maxIter
 * @property {string} [workdir]
 * @property {"single" | "parallel"} mode
 * @property {number} parallelism
 * @property {"first-pass-wins" | "best-score-wins"} selector
 * @property {number} [timeBudgetMs]
 * @property {string} [commandPolicyPath]
 * @property {string} [sandboxPolicyPath]
 */

export {};
