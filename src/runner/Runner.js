/**
 * @typedef {Object} RunResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} exitCode
 * @property {boolean} timedOut
 */

/**
 * @typedef {Object} Runner
 * @property {(command: string, options: {cwd: string, timeoutMs: number}) => Promise<RunResult>} run
 */

export {};
