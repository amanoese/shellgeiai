import { createLogUpdate } from "log-update";

const BAR_WIDTH = 12;
const BAR_COUNT_ORDER = ["running", "planning", "judging", "passed", "failed", "stopped"];

function formatPlainProgressEvent(event) {
  switch (event.type) {
    case "session-phase":
      return `[progress] phase ${event.phaseIndex ?? 0}/${event.phaseCount ?? 0} ${event.phase ?? "unknown"}: ${event.message ?? "(no message)"}`;
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

function createNoopCleanupReporter(writeEvent) {
  const reporter = (event) => {
    writeEvent(event);
  };
  reporter.cleanup = () => {};
  return reporter;
}

function createJsonlReporter(write) {
  return createNoopCleanupReporter((event) => {
    write(`${JSON.stringify(event)}\n`);
  });
}

function createPlainReporter(write) {
  return createNoopCleanupReporter((event) => {
    write(`${formatPlainProgressEvent(event)}\n`);
  });
}

function createBarState() {
  return {
    totalWorkers: 0,
    workers: new Map(),
    stopReason: null,
    selectedCandidateId: null,
    sessionPhase: "initializing",
    sessionPhaseIndex: 1,
    sessionPhaseCount: 7,
    sessionPhaseMessage: ""
  };
}

function updateBarState(state, event) {
  switch (event.type) {
    case "session-phase":
      state.sessionPhase = event.phase ?? state.sessionPhase;
      state.sessionPhaseIndex = event.phaseIndex ?? state.sessionPhaseIndex;
      state.sessionPhaseCount = event.phaseCount ?? state.sessionPhaseCount;
      state.sessionPhaseMessage = event.message ?? "";
      return;
    case "session-started":
      state.totalWorkers = event.workerCount ?? state.totalWorkers;
      return;
    case "worker-started": {
      const worker = ensureWorkerState(state, event.workerId);
      worker.strategy = event.strategy ?? "default";
      worker.maxAttempts = Math.max(1, event.maxAttempts ?? worker.maxAttempts ?? 1);
      return;
    }
    case "worker-state": {
      const worker = ensureWorkerState(state, event.workerId);
      worker.state = event.state ?? "idle";
      return;
    }
    case "attempt-started": {
      const worker = ensureWorkerState(state, event.workerId);
      worker.iteration = event.iteration ?? worker.iteration;
      worker.state = worker.state === "idle" ? "planning" : worker.state;
      return;
    }
    case "attempt-finished": {
      const worker = ensureWorkerState(state, event.workerId);
      worker.lastAttemptPassed = event.passed ?? false;
      worker.lastReason = event.reason ?? "";
      return;
    }
    case "worker-finished": {
      const worker = ensureWorkerState(state, event.workerId);
      worker.outcome = event.passed
        ? "passed"
        : worker.state === "stopped" || /stopped/i.test(event.reason ?? "")
          ? "stopped"
          : "failed";
      worker.lastReason = event.reason ?? worker.lastReason;
      return;
    }
    case "session-finished":
      state.stopReason = event.stopReason ?? null;
      state.selectedCandidateId = event.selectedCandidateId ?? null;
      return;
    default:
      return;
  }
}

function ensureWorkerState(state, workerId) {
  if (!state.workers.has(workerId)) {
    state.workers.set(workerId, {
      workerId,
      strategy: "",
      state: "idle",
      iteration: 0,
      maxAttempts: 1,
      outcome: null,
      lastAttemptPassed: false,
      lastReason: ""
    });
  }

  return state.workers.get(workerId);
}

function renderBarFrame(state) {
  const workers = Array.from(state.workers.values());
  const totalWorkers = Math.max(state.totalWorkers, workers.length);
  const completedWorkers = workers.filter((worker) => worker.outcome != null).length;
  const counts = buildStateCounts(workers);
  const lines = [
    `Solve ${formatProgressBar(state.sessionPhaseIndex, state.sessionPhaseCount)} ${state.sessionPhaseIndex}/${state.sessionPhaseCount} ${state.sessionPhase}`
  ];

  if (state.sessionPhaseMessage) {
    lines.push(`message: ${state.sessionPhaseMessage}`);
  }

  if (state.sessionPhase === "executing") {
    lines.push(
      `Workers ${formatProgressBar(completedWorkers, totalWorkers)} ${completedWorkers}/${totalWorkers} done | ${formatCounts(counts)}`
    );
    lines.push(
      ...workers
        .slice()
        .sort((left, right) => {
          const priorityDiff = getWorkerDisplayPriority(left) - getWorkerDisplayPriority(right);
          return priorityDiff !== 0 ? priorityDiff : left.workerId.localeCompare(right.workerId);
        })
        .map(formatWorkerLine)
        .filter(Boolean)
    );
  }

  if (state.stopReason) {
    lines.push(`stop: ${state.stopReason}`);
  }
  if (state.selectedCandidateId) {
    lines.push(`selected: ${state.selectedCandidateId}`);
  }

  return lines.join("\n");
}

function buildStateCounts(workers) {
  const counts = Object.fromEntries(BAR_COUNT_ORDER.map((status) => [status, 0]));

  for (const worker of workers) {
    const status = worker.outcome ?? worker.state;
    if (status in counts) {
      counts[status] += 1;
    }
  }

  return counts;
}

function formatCounts(counts) {
  return BAR_COUNT_ORDER.map((status) => `${status}:${counts[status] ?? 0}`).join(" ");
}

function getWorkerDisplayPriority(worker) {
  if (worker.outcome != null) {
    return 1;
  }

  switch (worker.state) {
    case "running":
      return 0;
    case "planning":
      return 1;
    case "judging":
      return 2;
    case "stopped":
      return 3;
    default:
      return 4;
  }
}

function formatWorkerLine(worker) {
  const attemptText = `attempt(${getWorkerAttemptCount(worker)}/${worker.maxAttempts ?? 1})`;
  return `${worker.workerId} ${formatWorkerProgressBar(worker)} ${getWorkerStatus(worker)}: ${attemptText}`;
}

function getWorkerStatus(worker) {
  if (worker.outcome != null) {
    return worker.outcome;
  }

  return worker.state ?? "idle";
}

function getWorkerAttemptCount(worker) {
  if (worker.iteration > 0) {
    return worker.iteration;
  }
  if (worker.state === "planning") {
    return 1;
  }

  return 0;
}

function formatProgressBar(completed, total) {
  if (total <= 0) {
    return `[${".".repeat(BAR_WIDTH)}]`;
  }

  const filledCount = Math.min(BAR_WIDTH, Math.round((completed / total) * BAR_WIDTH));
  const emptyCount = Math.max(0, BAR_WIDTH - filledCount);
  return `[${"#".repeat(filledCount)}${"-".repeat(emptyCount)}]`;
}

function formatWorkerProgressBar(worker) {
  const maxAttempts = Math.max(1, worker.maxAttempts ?? 1);
  const progressFraction =
    worker.outcome != null ? 1 : Math.min(1, Math.max(0, getWorkerAttemptCount(worker) / maxAttempts));
  const filledCount = Math.min(BAR_WIDTH, Math.round(progressFraction * BAR_WIDTH));
  const emptyCount = Math.max(0, BAR_WIDTH - filledCount);

  return `[${"#".repeat(filledCount)}${"-".repeat(emptyCount)}]`;
}

function normalizeBarStream(write, options = {}) {
  if (write && typeof write === "object" && typeof write.write === "function") {
    return write;
  }

  const fallbackStream = options.stream ?? process.stderr;
  const writeFn = typeof write === "function" ? write : fallbackStream.write.bind(fallbackStream);

  return {
    write: writeFn,
    isTTY: options.isTTY ?? fallbackStream.isTTY,
    columns: options.columns ?? fallbackStream.columns,
    rows: options.rows ?? fallbackStream.rows
  };
}

function createBarReporter(write, options = {}) {
  const state = createBarState();
  const logUpdate = createLogUpdate(normalizeBarStream(write, options), { showCursor: false });
  const reporter = (event) => {
    updateBarState(state, event);
    logUpdate(renderBarFrame(state));
  };
  reporter.cleanup = () => {
    logUpdate.clear();
    logUpdate.done();
  };
  return reporter;
}

export function createProgressReporter(mode, write = process.stderr.write.bind(process.stderr), options = {}) {
  if (mode === "off" || mode == null) {
    return undefined;
  }

  const isTTY = options.isTTY ?? process.stderr.isTTY === true;
  const effectiveMode = mode === "bar" && !isTTY ? "plain" : mode;

  if (effectiveMode === "jsonl") {
    return createJsonlReporter(write);
  }
  if (effectiveMode === "bar") {
    return createBarReporter(write, options);
  }

  return createPlainReporter(write);
}
