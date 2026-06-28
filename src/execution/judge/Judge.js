/**
 * @typedef {Object} JudgeScoreBreakdown
 * @property {number} correctness
 * @property {number} stdoutQuality
 * @property {number} stderrQuality
 * @property {number} expectedOutput
 */

/**
 * @typedef {Object} JudgeScore
 * @property {number} value
 * @property {JudgeScoreBreakdown} breakdown
 */

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
 * @property {JudgeScore} score
 */

/**
 * @typedef {Object} Judge
 * @property {(input: JudgeInput) => Promise<JudgeDecision>} judge
 */

export {};
