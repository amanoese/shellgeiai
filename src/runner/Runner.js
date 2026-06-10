/**
 * @typedef {Object} RunnerLimits
 * @property {number} wallClockMs
 * @property {number} stdoutMaxBytes
 * @property {number} stderrMaxBytes
 * @property {number} [memoryMaxBytes]
 * @property {number} [cpuCount]
 * @property {number} [processMaxCount]
 * @property {"off" | "on"} networkAccess
 */

/**
 * @typedef {Object} SandboxPolicy
 * @property {"off" | "on"} networkAccess
 * @property {string} filesystemScope
 */

/**
 * @typedef {Object} RunResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} exitCode
 * @property {boolean} timedOut
 * @property {boolean} [aborted]
 * @property {number} [durationMs]
 */

/**
 * @typedef {Object} RunOptions
 * @property {string} cwd
 * @property {number} [timeoutMs]
 * @property {RunnerLimits} [limits]
 * @property {SandboxPolicy} [sandboxPolicy]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} Runner
 * @property {string} [name]
 * @property {(command: string, options: RunOptions) => Promise<RunResult>} run
 */

export {};
