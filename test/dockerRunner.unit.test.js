import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const commandExistsMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("../src/util/exec.js", () => ({
  commandExists: commandExistsMock
}));

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("DockerRunner", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    commandExistsMock.mockReset();
    commandExistsMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("times out only after the child closes", async () => {
    const { DockerRunner } = await import("../src/runner/dockerRunner.js");
    const child = createFakeChild();
    const cleanupChild = createFakeChild();
    spawnMock
      .mockReturnValueOnce(child)
      .mockReturnValueOnce(cleanupChild);

    const runPromise = new DockerRunner({ image: "shellgeiai:test" }).run("sleep 10", {
      cwd: process.cwd(),
      timeoutMs: 10,
      limits: {
        stdoutMaxBytes: 1024,
        stderrMaxBytes: 1024
      },
      sandboxPolicy: {
        networkAccess: "off"
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", 137);
    cleanupChild.emit("close", 0);
    const result = await runPromise;

    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.exitCode).toBe(137);
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["rm", "-f", result.containerName],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"]
      })
    );
    expect(result.cleanup).toEqual({
      attempted: true,
      exitCode: 0,
      stderr: ""
    });
  });

  it("marks aborted runs separately from timeouts", async () => {
    const { DockerRunner } = await import("../src/runner/dockerRunner.js");
    const child = createFakeChild();
    const cleanupChild = createFakeChild();
    spawnMock
      .mockReturnValueOnce(child)
      .mockReturnValueOnce(cleanupChild);

    const abortController = new AbortController();
    const runPromise = new DockerRunner({ image: "shellgeiai:test" }).run("sleep 10", {
      cwd: process.cwd(),
      timeoutMs: 100,
      limits: {
        stdoutMaxBytes: 1024,
        stderrMaxBytes: 1024
      },
      sandboxPolicy: {
        networkAccess: "off"
      },
      signal: abortController.signal
    });

    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", 137);
    cleanupChild.emit("close", 0);
    const result = await runPromise;

    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(137);
    expect(result.cleanup).toEqual({
      attempted: true,
      exitCode: 0,
      stderr: ""
    });
  });

  it("classifies docker cli failures from stderr", async () => {
    const { DockerRunner } = await import("../src/runner/dockerRunner.js");
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const runPromise = new DockerRunner({ image: "shellgeiai:test" }).run("printf ok", {
      cwd: process.cwd(),
      timeoutMs: 100,
      limits: {
        stdoutMaxBytes: 1024,
        stderrMaxBytes: 1024
      },
      sandboxPolicy: {
        networkAccess: "off"
      }
    });

    await Promise.resolve();
    child.stderr.emit("data", Buffer.from("docker: Error response from daemon: failed to remove container\n"));
    child.emit("close", 125);
    const result = await runPromise;

    expect(result.failure).toEqual({
      type: "container-cleanup-failed",
      message: "docker: Error response from daemon: failed to remove container"
    });
  });

  it("records cleanup failures after a timed out run", async () => {
    const { DockerRunner } = await import("../src/runner/dockerRunner.js");
    const child = createFakeChild();
    const cleanupChild = createFakeChild();
    spawnMock
      .mockReturnValueOnce(child)
      .mockReturnValueOnce(cleanupChild);

    const runPromise = new DockerRunner({ image: "shellgeiai:test" }).run("sleep 10", {
      cwd: process.cwd(),
      timeoutMs: 10,
      limits: {
        stdoutMaxBytes: 1024,
        stderrMaxBytes: 1024
      },
      sandboxPolicy: {
        networkAccess: "off"
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    child.emit("close", 137);
    cleanupChild.stderr.emit("data", Buffer.from("Error: cannot remove container\n"));
    cleanupChild.emit("close", 1);
    const result = await runPromise;

    expect(result.failure).toEqual({
      type: "container-cleanup-failed",
      message: "Error: cannot remove container"
    });
    expect(result.cleanup).toEqual({
      attempted: true,
      exitCode: 1,
      stderr: "Error: cannot remove container\n"
    });
  });

  it("fails early when docker is unavailable", async () => {
    commandExistsMock.mockResolvedValue(false);
    const { DockerRunner } = await import("../src/runner/dockerRunner.js");

    await expect(
      new DockerRunner({ image: "shellgeiai:test" }).run("printf ok", {
        cwd: process.cwd(),
        limits: {},
        sandboxPolicy: {}
      })
    ).rejects.toThrow("Docker runner was requested, but the 'docker' command is not available.");
  });
});
