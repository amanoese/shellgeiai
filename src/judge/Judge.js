/**
 * @typedef {Object} JudgeInput
 * @property {string} command
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} exitCode
 * @property {boolean} timedOut
 * @property {string} [expectedOutput]
 */

/**
 * @typedef {Object} JudgeDecision
 * @property {boolean} passed
 * @property {string} reason
 */

/**
 * @typedef {Object} Judge
 * @property {(input: JudgeInput) => Promise<JudgeDecision>} judge
 */

export {};
