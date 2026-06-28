import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCommand } from "../src/core/check.js";
import { replaySolveLog } from "../src/core/replay.js";
import { solveProblem } from "../src/core/solve.js";
import { SimpleJudge } from "../src/execution/judge/simpleJudge.js";
import { DockerRunner } from "../src/execution/runner/dockerRunner.js";
import { LocalRunner } from "../src/execution/runner/localRunner.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("checkCommand", () => {
  it("defaults workdir to current directory and records writable workdir mode", async () => {
    const runSpy = vi.fn().mockResolvedValue({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      durationMs: 1,
      failure: null,
      cleanup: null
    });

    const runner = {
      name: "spy-runner",
      image: "shellgeiai:test",
      run: runSpy
    };

    const result = await checkCommand({
      command: "printf 'ok\\n'",
      problem: "print ok",
      expectedOutput: "ok",
      writableWorkdir: true,
      runner,
      judge: new SimpleJudge()
    });

    expect(runSpy).toHaveBeenCalledWith(
      "printf 'ok\\n'",
      expect.objectContaining({
        cwd: process.cwd(),
        writableWorkdir: true
      })
    );
    expect(result.workdir).toBe(process.cwd());
    expect(result.runner).toEqual(
      expect.objectContaining({
        writableWorkdir: true
      })
    );

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.workdir).toBe(process.cwd());
    expect(logContent.runner).toEqual(
      expect.objectContaining({
        writableWorkdir: true
      })
    );
  });

  it("runs an explicit command, judges it, and writes a check log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-check-"));
    tempDirs.push(requestedWorkdir);

    const result = await checkCommand({
      command: "printf 'ok\\n'",
      problem: "print ok",
      expectedOutput: "ok",
      requestedWorkdir,
      runner: new LocalRunner(),
      judge: new SimpleJudge()
    });

    expect(result.finalCheck.passed).toBe(true);
    expect(result.selector.name).toBe("manual-check");
    expect(result.output).toBe("ok");

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.mode).toBe("check");
    expect(logContent.command).toBe("printf 'ok\\n'");
    expect(logContent.finalCheck.passed).toBe(true);
    expect(logContent.problemSpec.expectedOutput).toBe("ok");
  });

  it("blocks unsafe commands before execution", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-check-"));
    tempDirs.push(requestedWorkdir);

    const result = await checkCommand({
      command: "rm -rf /tmp/demo",
      requestedWorkdir,
      runner: new LocalRunner(),
      judge: new SimpleJudge()
    });

    expect(result.finalCheck.passed).toBe(false);
    expect(result.finalCheck.reason).toContain("blocked by safety policy");
    expect(result.attempts[0].exitCode).toBeNull();
  });

  it("passes docker runner options through to command execution and logs the docker runtime", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-check-"));
    tempDirs.push(requestedWorkdir);
    const runnerLimits = {
      wallClockMs: 1_500,
      stdoutMaxBytes: 128,
      stderrMaxBytes: 64,
      memoryMaxBytes: 64 * 1024 * 1024,
      cpuCount: 1,
      processMaxCount: 16,
      networkAccess: "off"
    };
    const sandboxPolicy = {
      networkAccess: "off",
      filesystemScope: "workdir-only"
    };
    const dockerRunner = new DockerRunner({
      image: "shellgeiai:test"
    });
    const runSpy = vi.spyOn(dockerRunner, "run").mockResolvedValue({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      durationMs: 12
    });

    const result = await checkCommand({
      command: "printf 'ok\\n'",
      problem: "print ok",
      expectedOutput: "ok",
      requestedWorkdir,
      runner: dockerRunner,
      runnerLimits,
      sandboxPolicy,
      judge: new SimpleJudge()
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith("printf 'ok\\n'", {
      cwd: requestedWorkdir,
      timeoutMs: undefined,
      limits: runnerLimits,
      sandboxPolicy,
      writableWorkdir: false
    });
    expect(result.finalCheck.passed).toBe(true);
    expect(result.runner.name).toBe("docker");

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.runner.name).toBe("docker");
    expect(logContent.runner.image).toBe("shellgeiai:test");
    expect(logContent.runner.limits).toEqual(runnerLimits);
    expect(logContent.runner.sandboxPolicy).toEqual(sandboxPolicy);

    runSpy.mockRestore();
  });

  it("records docker runner failures in the check log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-check-"));
    tempDirs.push(requestedWorkdir);
    const dockerRunner = new DockerRunner({
      image: "shellgeiai:test"
    });
    const runSpy = vi.spyOn(dockerRunner, "run").mockResolvedValue({
      stdout: "",
      stderr: "docker: Error response from daemon: failed to remove container\n",
      exitCode: 125,
      timedOut: false,
      aborted: false,
      durationMs: 8,
      failure: {
        type: "container-cleanup-failed",
        message: "docker: Error response from daemon: failed to remove container"
      },
      cleanup: {
        attempted: true,
        exitCode: 1,
        stderr: "docker: Error response from daemon: failed to remove container\n"
      },
      image: "shellgeiai:test"
    });

    const result = await checkCommand({
      command: "printf 'ok\\n'",
      requestedWorkdir,
      runner: dockerRunner,
      judge: new SimpleJudge()
    });

    expect(result.attempts[0].runnerFailure).toEqual({
      type: "container-cleanup-failed",
      message: "docker: Error response from daemon: failed to remove container"
    });
    expect(result.attempts[0].runnerCleanup).toEqual({
      attempted: true,
      exitCode: 1,
      stderr: "docker: Error response from daemon: failed to remove container\n"
    });

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.attempts[0].runnerFailure).toEqual({
      type: "container-cleanup-failed",
      message: "docker: Error response from daemon: failed to remove container"
    });
    expect(logContent.attempts[0].runnerCleanup).toEqual({
      attempted: true,
      exitCode: 1,
      stderr: "docker: Error response from daemon: failed to remove container\n"
    });

    runSpy.mockRestore();
  });
});

describe("replaySolveLog", () => {
  it("defaults replay workdir to current directory and records writable workdir mode", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-replay-"));
    tempDirs.push(requestedWorkdir);

    const solved = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf 'ok\\n'",
            explanation: "Print ok."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider(),
      requestedWorkdir
    });

    const runSpy = vi.fn().mockResolvedValue({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      durationMs: 1,
      failure: null,
      cleanup: null
    });

    const runner = {
      name: "spy-runner",
      image: "shellgeiai:test",
      run: runSpy
    };

    const replayed = await replaySolveLog({
      logPath: solved.logPath,
      writableWorkdir: true,
      runner,
      judge: new SimpleJudge()
    });

    expect(runSpy).toHaveBeenCalledWith(
      "printf 'ok\\n'",
      expect.objectContaining({
        cwd: process.cwd(),
        writableWorkdir: true
      })
    );
    expect(replayed.workdir).toBe(process.cwd());
    expect(replayed.runner).toEqual(
      expect.objectContaining({
        writableWorkdir: true
      })
    );

    const logContent = JSON.parse(await readFile(replayed.logPath, "utf8"));
    expect(logContent.workdir).toBe(process.cwd());
    expect(logContent.runner).toEqual(
      expect.objectContaining({
        writableWorkdir: true
      })
    );
  });

  it("replays the selected candidate from a solve log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-replay-"));
    tempDirs.push(requestedWorkdir);

    const solved = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf 'ok\\n'",
            explanation: "Print ok."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider(),
      requestedWorkdir
    });

    const replayed = await replaySolveLog({
      logPath: solved.logPath,
      runner: new LocalRunner(),
      judge: new SimpleJudge()
    });

    expect(replayed.finalCheck.passed).toBe(true);
    expect(replayed.command).toBe("printf 'ok\\n'");
    expect(replayed.selector.name).toBe("replay");
    expect(replayed.selector.reason).toContain("selected in the source log");

    const logContent = JSON.parse(await readFile(replayed.logPath, "utf8"));
    expect(logContent.mode).toBe("replay");
    expect(logContent.sourceLogPath).toBe(solved.logPath);
    expect(logContent.replayTarget.command).toBe("printf 'ok\\n'");
    expect(logContent.replayTarget.sourceCandidateId).toBe(solved.selector.selectedCandidateId);
    expect(logContent.replayTarget.sourceSelectedCandidateId).toBe(solved.selector.selectedCandidateId);
    expect(logContent.replayTarget.selectionReason).toContain("source log");
  });

  it("replays a specific attempt when attemptId is provided", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-replay-"));
    tempDirs.push(requestedWorkdir);
    let callCount = 0;

    const solved = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "test-engine",
        async generateCommand() {
          callCount += 1;
          if (callCount === 1) {
            return {
              command: "printf ''",
              explanation: "Fails first."
            };
          }

          return {
            command: "printf 'ok\\n'",
            explanation: "Succeeds second."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 2,
      plannerProvider: createTestPlannerProvider(),
      requestedWorkdir
    });

    const replayed = await replaySolveLog({
      logPath: solved.logPath,
      attemptId: solved.attempts[0].attemptId,
      runner: new LocalRunner(),
      judge: new SimpleJudge()
    });

    expect(replayed.command).toBe("printf ''");
    expect(replayed.output).toBe("");
    expect(replayed.finalCheck.passed).toBe(false);
    expect(replayed.stopReason).toContain(solved.attempts[0].attemptId);

    const logContent = JSON.parse(await readFile(replayed.logPath, "utf8"));
    expect(logContent.replayTarget.kind).toBe("attempt");
    expect(logContent.replayTarget.sourceAttemptId).toBe(solved.attempts[0].attemptId);
    expect(logContent.replayTarget.selectionReason).toContain("attempt");
  });

  it("blocks an unsafe replay target before rerunning it", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-replay-"));
    tempDirs.push(requestedWorkdir);

    const logPath = path.join(requestedWorkdir, "unsafe-solve-log.json");
    const unsafeCommand = "rm -rf /tmp/demo";
    const payload = {
      selectedCandidateId: "worker-1",
      workdir: requestedWorkdir,
      problem: "do something unsafe",
      problemSpec: {
        raw: "do something unsafe",
        problemText: "do something unsafe",
        metadata: {
          format: "plain-text"
        }
      },
      attempts: [
        {
          attemptId: "attempt-1",
          workerId: "worker-1",
          command: unsafeCommand,
          explanation: "Unsafe attempt."
        }
      ],
      candidates: [
        {
          candidateId: "worker-1",
          workerId: "worker-1",
          command: unsafeCommand,
          explanation: "Unsafe candidate."
        }
      ],
      runner: {
        name: "local",
        limits: {}
      }
    };
    await writeFile(logPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const replayed = await replaySolveLog({
      logPath,
      runner: new LocalRunner(),
      judge: new SimpleJudge()
    });

    expect(replayed.finalCheck.passed).toBe(false);
    expect(replayed.finalCheck.reason).toContain("blocked by safety policy");
    expect(replayed.attempts[0].exitCode).toBeNull();
    expect(replayed.stopReason).toContain("blocked by safety policy");
  });

  it("fails with a clear error when the requested attempt is missing", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-replay-"));
    tempDirs.push(requestedWorkdir);

    const solved = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf 'ok\\n'",
            explanation: "Print ok."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider(),
      requestedWorkdir
    });

    await expect(
      replaySolveLog({
        logPath: solved.logPath,
        attemptId: "missing-attempt",
        runner: new LocalRunner(),
        judge: new SimpleJudge()
      })
    ).rejects.toThrow("Replay log did not contain attempt 'missing-attempt'.");
  });

  it("replays with a docker runner and forwards replay limits and sandbox policy", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-replay-"));
    tempDirs.push(requestedWorkdir);
    const solved = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "test-engine",
        async generateCommand() {
          return {
            command: "printf 'ok\\n'",
            explanation: "Print ok."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      plannerProvider: createTestPlannerProvider(),
      requestedWorkdir
    });
    const runnerLimits = {
      wallClockMs: 2_000,
      stdoutMaxBytes: 256,
      stderrMaxBytes: 128,
      memoryMaxBytes: 96 * 1024 * 1024,
      cpuCount: 1,
      processMaxCount: 24,
      networkAccess: "off"
    };
    const sandboxPolicy = {
      networkAccess: "off",
      filesystemScope: "workdir-only"
    };
    const dockerRunner = new DockerRunner({
      image: "shellgeiai:test"
    });
    const runSpy = vi.spyOn(dockerRunner, "run").mockResolvedValue({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      durationMs: 10
    });

    const replayed = await replaySolveLog({
      logPath: solved.logPath,
      runner: dockerRunner,
      runnerLimits,
      sandboxPolicy,
      judge: new SimpleJudge()
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith("printf 'ok\\n'", {
      cwd: process.cwd(),
      timeoutMs: undefined,
      limits: runnerLimits,
      sandboxPolicy,
      writableWorkdir: false
    });
    expect(replayed.finalCheck.passed).toBe(true);
    expect(replayed.runner.name).toBe("docker");

    const logContent = JSON.parse(await readFile(replayed.logPath, "utf8"));
    expect(logContent.mode).toBe("replay");
    expect(logContent.runner.name).toBe("docker");
    expect(logContent.runner.image).toBe("shellgeiai:test");
    expect(logContent.runner.limits).toEqual(runnerLimits);
    expect(logContent.runner.sandboxPolicy).toEqual(sandboxPolicy);

    runSpy.mockRestore();
  });
});
