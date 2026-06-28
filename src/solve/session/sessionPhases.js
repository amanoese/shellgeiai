export const SESSION_PHASES = [
  "initializing",
  "problem-parsing",
  "planning",
  "executing",
  "selecting",
  "logging",
  "completed"
];

export function getSessionPhaseEvent(phase, message) {
  const phaseIndex = SESSION_PHASES.indexOf(phase);

  if (phaseIndex === -1) {
    throw new Error(`Unknown session phase: ${phase}`);
  }

  return {
    type: "session-phase",
    phase,
    phaseIndex: phaseIndex + 1,
    phaseCount: SESSION_PHASES.length,
    ...(message ? { message } : {})
  };
}
