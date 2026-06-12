export function buildPlannerTelemetry({
  provider,
  attemptedProvider,
  fallbackReason = null,
  promptVersion = null,
  prompt = null,
  rawResponse = null
}) {
  return {
    provider,
    attemptedProvider: attemptedProvider ?? provider,
    fallbackReason,
    promptVersion,
    prompt,
    rawResponse
  };
}
