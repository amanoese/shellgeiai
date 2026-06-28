import { getSessionPhaseEvent } from "./sessionPhases.js";

export function reportSolveProgress(session, event) {
  session.onProgress?.({
    sessionId: session.sessionId,
    ...event
  });
}

export function reportSessionPhase(session, phase, message) {
  reportSolveProgress(session, getSessionPhaseEvent(phase, message));
}
