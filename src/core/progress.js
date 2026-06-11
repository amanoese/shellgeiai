export function reportSolveProgress(session, event) {
  session.onProgress?.({
    sessionId: session.sessionId,
    ...event
  });
}
