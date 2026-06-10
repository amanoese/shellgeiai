export function createExecutionPlan(session) {
  const workerCount = Math.max(1, session.parallelism ?? 1);
  const strategies = ["default", "awk-first", "text-filter", "normalization"];

  return {
    mode: session.mode,
    parallelism: workerCount,
    workerTasks: Array.from({ length: workerCount }, (_, index) => ({
      workerId: `worker-${index + 1}`,
      strategy: strategies[index % strategies.length],
      maxAttempts: session.maxIterations
    }))
  };
}
