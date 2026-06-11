function formatPlainProgressEvent(event) {
  switch (event.type) {
    case "session-started":
      return `[progress] session started: workers=${event.workerCount ?? 0}, parallelism=${event.parallelism ?? 1}`;
    case "worker-started":
      return `[progress] ${event.workerId} started with strategy=${event.strategy ?? "default"}`;
    case "worker-state":
      return `[progress] ${event.workerId} state=${event.state ?? "idle"}`;
    case "attempt-started":
      return `[progress] ${event.workerId} attempt ${event.iteration} started: ${event.command}`;
    case "attempt-finished":
      return `[progress] ${event.workerId} attempt ${event.iteration} ${event.passed ? "passed" : "failed"}: ${event.reason ?? "(no reason)"}`;
    case "worker-finished":
      return `[progress] ${event.workerId} finished after ${event.attemptCount ?? 0} attempt(s): ${event.passed ? "passed" : "failed"} (${event.reason ?? "(no reason)"})`;
    case "session-finished":
      return `[progress] session finished: attempts=${event.attemptCount ?? 0}, candidates=${event.candidateCount ?? 0}, failed-workers=${event.failedWorkerCount ?? 0}, stop=${event.stopReason ?? "(none)"}`;
    default:
      return `[progress] ${event.type}`;
  }
}

export function createProgressReporter(mode, write = process.stderr.write.bind(process.stderr)) {
  if (mode === "off" || mode == null) {
    return undefined;
  }

  if (mode === "jsonl") {
    return (event) => {
      write(`${JSON.stringify(event)}\n`);
    };
  }

  return (event) => {
    write(`${formatPlainProgressEvent(event)}\n`);
  };
}
