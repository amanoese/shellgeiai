import { describe, expect, it } from "vitest";
import { buildDockerRunArgs } from "../src/runner/dockerRunner.js";
import { createDefaultRunnerLimits } from "../src/runner/limits.js";
import { LocalRunner } from "../src/runner/localRunner.js";

describe("LocalRunner", () => {
  it("returns the common run result shape", async () => {
    const runner = new LocalRunner();
    const result = await runner.run("printf 'hello\\n'", {
      cwd: process.cwd(),
      limits: createDefaultRunnerLimits()
    });

    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.durationMs).toBeTypeOf("number");
  });

  it("honors stdout byte limits", async () => {
    const runner = new LocalRunner();
    const result = await runner.run("printf '1234567890'", {
      cwd: process.cwd(),
      limits: {
        ...createDefaultRunnerLimits(),
        stdoutMaxBytes: 4
      }
    });

    expect(result.stdout).toBe("1234");
  });

  it("aborts a running command when the signal is cancelled", async () => {
    const runner = new LocalRunner();
    const abortController = new AbortController();
    const runPromise = runner.run("sleep 1; printf 'late\\n'", {
      cwd: process.cwd(),
      limits: createDefaultRunnerLimits(),
      signal: abortController.signal
    });

    setTimeout(() => {
      abortController.abort();
    }, 20);

    const result = await runPromise;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
  });
});

describe("buildDockerRunArgs", () => {
  it("builds docker arguments with resource and sandbox limits", () => {
    const args = buildDockerRunArgs("printf '123\\n'", {
      cwd: "/tmp/example",
      limits: {
        ...createDefaultRunnerLimits(),
        cpuCount: 2,
        memoryMaxBytes: 128 * 1024 * 1024,
        processMaxCount: 32
      },
      sandboxPolicy: {
        networkAccess: "off",
        filesystemScope: "workdir-only"
      }
    });

    expect(args).toEqual([
      "run",
      "--rm",
      "--name",
      expect.stringMatching(/^shellgeiai-\d+-[0-9a-f]{8}$/),
      "--workdir",
      "/workspace",
      "--volume",
      "/tmp/example:/workspace:rw",
      "--network",
      "none",
      "--cpus",
      "2",
      "--memory",
      "128m",
      "--pids-limit",
      "32",
      expect.any(String),
      "/bin/bash",
      "--noprofile",
      "--norc",
      "-lc",
      "printf '123\\n'"
    ]);
  });

  it("does not force network none when enabled by policy", () => {
    const args = buildDockerRunArgs("echo ok", {
      cwd: "/tmp/example",
      limits: {
        ...createDefaultRunnerLimits(),
        networkAccess: "on"
      },
      sandboxPolicy: {
        networkAccess: "on",
        filesystemScope: "workdir-only"
      }
    });

    expect(args).not.toContain("--network");
  });

  it("uses an explicit image override when provided", () => {
    const args = buildDockerRunArgs(
      "echo ok",
      {
        cwd: "/tmp/example",
        limits: createDefaultRunnerLimits(),
        sandboxPolicy: {
          networkAccess: "off",
          filesystemScope: "workdir-only"
        }
      },
      {
        image: "shellgeiai:test"
      }
    );

    expect(args[args.indexOf("/bin/bash") - 1]).toBe("shellgeiai:test");
  });
});
