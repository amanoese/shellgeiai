import type { ProgressSession, SessionPhase, SessionPhaseEvent, SolveProgressPayload } from "../types.js";

export const SESSION_PHASES: SessionPhase[] = [
  "initializing",
  "problem-parsing",
  "planning",
  "executing",
  "selecting",
  "logging",
  "completed"
];

export function getSessionPhaseEvent(phase: SessionPhase, message?: string): SessionPhaseEvent {
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


export function reportSolveProgress(session: ProgressSession, event: SolveProgressPayload) {
  session.onProgress?.({
    sessionId: session.sessionId,
    ...event
  });
}

export function reportSessionPhase(session: ProgressSession, phase: SessionPhase, message?: string) {
  reportSolveProgress(session, getSessionPhaseEvent(phase, message));
}
