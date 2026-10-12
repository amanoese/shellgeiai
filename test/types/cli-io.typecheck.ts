import type { SolveProgressEvent } from "../../src/types.js";
import { createProgressReporter } from "../../src/io/progress.js";
import type { LogDisplayResult } from "../../src/io/logs.js";
import { formatResult } from "../../src/cli/commands.js";

const reporter = createProgressReporter("plain", () => {});
if (reporter) {
  reporter({ type: "session-phase", sessionId: "session", phase: "executing", phaseIndex: 4, phaseCount: 7 });
  // @ts-expect-error Session phase events require phaseIndex and phaseCount.
  reporter({ type: "session-phase", sessionId: "session", phase: "executing" });
  // @ts-expect-error Worker completion requires attemptCount and its worker identity.
  reporter({ type: "worker-finished", sessionId: "session", passed: true });
  // @ts-expect-error Worker state is constrained to the shared phase union.
  reporter({ type: "worker-state", sessionId: "session", workerId: "worker", strategy: "default", state: "flying" });
  // @ts-expect-error Attempt completion requires a command, iteration, and reason.
  reporter({ type: "attempt-finished", sessionId: "session", workerId: "worker", strategy: "default", passed: false });
  // @ts-expect-error Session completion requires counts and selection metadata.
  reporter({ type: "session-finished", sessionId: "session", stopReason: null });
  reporter.cleanup();
}

function progressContract(event: SolveProgressEvent): string {
  switch (event.type) {
    case "session-phase": return event.phase;
    case "session-started": return String(event.workerCount);
    case "worker-started": return String(event.maxAttempts);
    case "worker-state": return event.state;
    case "attempt-started": return event.command;
    case "attempt-finished": return event.reason;
    case "worker-finished": return String(event.attemptCount);
    case "session-finished": return String(event.candidateCount);
    default: { const unreachable: never = event; return unreachable; }
  }
}

declare const legacy: LogDisplayResult;
formatResult(legacy);
// @ts-expect-error Persisted scalar metadata is not trusted as a domain string.
const explanation: string = legacy.explanation;
void [progressContract, explanation];
