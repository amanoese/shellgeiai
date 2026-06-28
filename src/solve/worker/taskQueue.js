export function calculateWorkerConcurrency(workerTaskCount, requestedParallelism) {
  const availableTasks = Math.max(0, workerTaskCount);
  const requestedWorkers = Math.max(1, requestedParallelism ?? 1);

  return Math.min(requestedWorkers, Math.max(1, availableTasks));
}

export function createWorkerTaskQueue(workerTasks) {
  const queue = [...workerTasks];

  return {
    takeNext() {
      return queue.shift() ?? null;
    },
    isEmpty() {
      return queue.length === 0;
    },
    size() {
      return queue.length;
    }
  };
}
