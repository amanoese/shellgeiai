export function createDefaultRunnerLimits() {
  return {
    wallClockMs: 5_000,
    stdoutMaxBytes: 64 * 1024,
    stderrMaxBytes: 64 * 1024,
    memoryMaxBytes: 256 * 1024 * 1024,
    cpuCount: 1,
    processMaxCount: 64,
    networkAccess: "off"
  };
}
