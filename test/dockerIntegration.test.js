import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkCommand } from "../src/core/check.js";
import { replaySolveLog } from "../src/core/replay.js";
import { solveProblem } from "../src/core/solve.js";
import { SimpleJudge } from "../src/judge/simpleJudge.js";
import { DockerRunner } from "../src/runner/dockerRunner.js";
import { createDefaultRunnerLimits } from "../src/runner/limits.js";
import { LocalRunner } from "../src/runner/localRunner.js";

const IMAGE_CANDIDATES = [
  process.env.SHELLGEIAI_DOCKER_IMAGE,
  "theoldmoon0602/shellgeibot",
  "ubuntu:24.04",
  "ubuntu:latest",
  "ubuntu:22.10",
  "node:latest",
  "catthehacker/ubuntu:act-latest"
].filter(Boolean);
const tempDirs = [];

function imageExists(image) {
  const result = spawnSync("docker", ["image", "inspect", image], {
    encoding: "utf8"
  });
  return result.status === 0;
}

function resolveDockerImage() {
  for (const image of IMAGE_CANDIDATES) {
    if (imageExists(image)) {
      return image;
    }
  }

  return null;
}

function inspectDockerEnvironment() {
  const version = spawnSync("docker", ["--version"], {
    encoding: "utf8"
  });
  if (version.status !== 0) {
    return {
      ready: false,
      reason: "docker CLI is not available."
    };
  }

  const info = spawnSync("docker", ["info"], {
    encoding: "utf8"
  });
  if (info.status !== 0) {
    return {
      ready: false,
      reason: "docker daemon is not reachable."
    };
  }

  const image = resolveDockerImage();
  if (!image) {
    return {
      ready: false,
      reason: `none of the Docker test images are available locally: ${IMAGE_CANDIDATES.join(", ")}.`
    };
  }

  return {
    ready: true,
    reason: "",
    image
  };
}

const dockerEnvironment = inspectDockerEnvironment();
const describeDocker = dockerEnvironment.ready ? describe : describe.skip;

if (!dockerEnvironment.ready) {
  console.warn(`[dockerIntegration] skipped: ${dockerEnvironment.reason}`);
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describeDocker("Docker integration", () => {
  it("runs commands inside a real container with the mounted workdir", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-docker-runner-"));
    tempDirs.push(requestedWorkdir);
    const runner = new DockerRunner({
      image: dockerEnvironment.image
    });

    const result = await runner.run("printf 'from-docker' > proof.txt; pwd", {
      cwd: requestedWorkdir,
      limits: createDefaultRunnerLimits(),
      sandboxPolicy: {
        networkAccess: "off",
        filesystemScope: "workdir-only"
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.stdout.trim()).toBe("/workspace");
    expect(await readFile(path.join(requestedWorkdir, "proof.txt"), "utf8")).toBe("from-docker");
  }, 20_000);

  it("reports timeouts from a real container run", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-docker-timeout-"));
    tempDirs.push(requestedWorkdir);
    const runner = new DockerRunner({
      image: dockerEnvironment.image
    });

    const result = await runner.run("sleep 5", {
      cwd: requestedWorkdir,
      timeoutMs: 50,
      limits: createDefaultRunnerLimits(),
      sandboxPolicy: {
        networkAccess: "off",
        filesystemScope: "workdir-only"
      }
    });

    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.cleanup).toEqual({
      attempted: true,
      exitCode: 0,
      stderr: ""
    });
  }, 20_000);

  it("reports aborts from a real container run", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-docker-abort-"));
    tempDirs.push(requestedWorkdir);
    const runner = new DockerRunner({
      image: dockerEnvironment.image
    });
    const abortController = new AbortController();
    const runPromise = runner.run("sleep 5", {
      cwd: requestedWorkdir,
      timeoutMs: 5_000,
      limits: createDefaultRunnerLimits(),
      sandboxPolicy: {
        networkAccess: "off",
        filesystemScope: "workdir-only"
      },
      signal: abortController.signal
    });

    setTimeout(() => {
      abortController.abort();
    }, 50);

    const result = await runPromise;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.cleanup).toEqual({
      attempted: true,
      exitCode: 0,
      stderr: ""
    });
  }, 20_000);

  it("checks an explicit command through DockerRunner and writes a docker-backed log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-docker-check-"));
    tempDirs.push(requestedWorkdir);

    const result = await checkCommand({
      command: "printf 'ok\\n'",
      problem: "print ok",
      expectedOutput: "ok",
      requestedWorkdir,
      runner: new DockerRunner({
        image: dockerEnvironment.image
      }),
      judge: new SimpleJudge()
    });

    expect(result.finalCheck.passed).toBe(true);
    expect(result.output).toBe("ok");
    expect(result.runner.name).toBe("docker");

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.mode).toBe("check");
    expect(logContent.runner.name).toBe("docker");
    expect(logContent.runner.image).toBe(dockerEnvironment.image);
    expect(logContent.finalCheck.passed).toBe(true);
  }, 20_000);

  it("solves through DockerRunner and writes a docker-backed solve log", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-docker-solve-"));
    tempDirs.push(requestedWorkdir);

    const result = await solveProblem({
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
      runner: new DockerRunner({
        image: dockerEnvironment.image
      }),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir
    });

    expect(result.finalCheck.passed).toBe(true);
    expect(result.output).toBe("ok");
    expect(result.runner.name).toBe("docker");

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
    expect(logContent.runner.name).toBe("docker");
    expect(logContent.runner.image).toBe(dockerEnvironment.image);
    expect(logContent.finalCheck.passed).toBe(true);
  }, 20_000);

  it("replays a saved solve candidate through DockerRunner", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-docker-replay-"));
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
      requestedWorkdir
    });

    const replayed = await replaySolveLog({
      logPath: solved.logPath,
      runner: new DockerRunner({
        image: dockerEnvironment.image
      }),
      judge: new SimpleJudge()
    });

    expect(replayed.finalCheck.passed).toBe(true);
    expect(replayed.command).toBe("printf 'ok\\n'");
    expect(replayed.output).toBe("ok");
    expect(replayed.runner.name).toBe("docker");

    const logContent = JSON.parse(await readFile(replayed.logPath, "utf8"));
    expect(logContent.mode).toBe("replay");
    expect(logContent.runner.name).toBe("docker");
    expect(logContent.runner.image).toBe(dockerEnvironment.image);
    expect(logContent.finalCheck.passed).toBe(true);
  }, 20_000);
});
