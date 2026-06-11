import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { commandExists } from "../util/exec.js";

const DEFAULT_IMAGE =
  process.env.SHELLGEIAI_DOCKER_IMAGE ?? "theoldmoon0602/shellgeibot";
const CONTAINER_WORKDIR = "/workspace";

function createContainerName() {
  return `shellgeiai-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function summarizeStderr(stderr) {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function classifyDockerFailure({ stderr, exitCode, timedOut, aborted, cleanup }) {
  if (cleanup?.attempted && cleanup.exitCode !== 0) {
    return {
      type: "container-cleanup-failed",
      message: summarizeStderr(cleanup.stderr) || "Docker cleanup failed without stderr output."
    };
  }

  if (timedOut || aborted || exitCode == null || exitCode === 0) {
    return null;
  }

  const message = summarizeStderr(stderr);
  if (!message) {
    return null;
  }

  if (exitCode === 125) {
    if (/(failed to remove|error removing|cleanup|cannot remove container)/i.test(message)) {
      return {
        type: "container-cleanup-failed",
        message
      };
    }

    return {
      type: "docker-cli-error",
      message
    };
  }

  return null;
}

async function forceCleanupContainer(containerName) {
  return await new Promise((resolve) => {
    const child = spawn("docker", ["rm", "-f", containerName], {
      env: {
        PATH: process.env.PATH ?? "",
        LANG: process.env.LANG ?? "C.UTF-8"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        attempted: true,
        exitCode: null,
        stderr: error instanceof Error ? error.message : String(error)
      });
    });

    child.on("close", (code) => {
      resolve({
        attempted: true,
        exitCode: code,
        stderr
      });
    });
  });
}

function bytesToDockerMemory(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }

  return String(Math.max(1, Math.floor(bytes / (1024 * 1024)))) + "m";
}

function appendLimitedText(current, chunk, maxBytes) {
  const next = current + chunk.toString();
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return next;
  }

  if (Buffer.byteLength(next) <= maxBytes) {
    return next;
  }

  return next.slice(0, maxBytes);
}

export function buildDockerRunArgs(command, options, config = {}) {
  const limits = options.limits ?? {};
  const sandboxPolicy = options.sandboxPolicy ?? {};
  const image = config.image ?? DEFAULT_IMAGE;
  const containerName = config.containerName ?? createContainerName();
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--workdir",
    CONTAINER_WORKDIR,
    "--volume",
    `${options.cwd}:${CONTAINER_WORKDIR}:rw`
  ];

  if (sandboxPolicy.networkAccess !== "on" || limits.networkAccess !== "on") {
    args.push("--network", "none");
  }

  if (limits.cpuCount) {
    args.push("--cpus", String(limits.cpuCount));
  }

  const memory = bytesToDockerMemory(limits.memoryMaxBytes);
  if (memory) {
    args.push("--memory", memory);
  }

  if (limits.processMaxCount) {
    args.push("--pids-limit", String(limits.processMaxCount));
  }

  args.push(image, "/bin/bash", "--noprofile", "--norc", "-lc", command);
  return args;
}

export class DockerRunner {
  name = "docker";

  constructor(config = {}) {
    this.image = config.image ?? DEFAULT_IMAGE;
  }

  async run(command, options) {
    if (!(await commandExists("docker"))) {
      throw new Error(
        "Docker runner was requested, but the 'docker' command is not available. Install Docker or use --runner local."
      );
    }

    const args = buildDockerRunArgs(command, options, {
      image: this.image
    });

    return await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timeoutMs = options.timeoutMs ?? options.limits?.wallClockMs ?? 5_000;
      const stdoutMaxBytes = options.limits?.stdoutMaxBytes;
      const stderrMaxBytes = options.limits?.stderrMaxBytes;
      const containerNameIndex = args.indexOf("--name");
      const containerName = containerNameIndex >= 0 ? args[containerNameIndex + 1] : createContainerName();
      const child = spawn("docker", args, {
        env: {
          PATH: process.env.PATH ?? "",
          LANG: process.env.LANG ?? "C.UTF-8"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let aborted = false;
      let settled = false;
      let cleanupRequested = false;

      const cleanup = () => {
        clearTimeout(timer);
        if (options.signal) {
          options.signal.removeEventListener("abort", handleAbort);
        }
      };

      const settle = (callback) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        callback();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        cleanupRequested = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      const handleAbort = () => {
        aborted = true;
        cleanupRequested = true;
        child.kill("SIGKILL");
      };

      if (options.signal?.aborted) {
        handleAbort();
      } else if (options.signal) {
        options.signal.addEventListener("abort", handleAbort, { once: true });
      }

      child.stdout.on("data", (chunk) => {
        stdout = appendLimitedText(stdout, chunk, stdoutMaxBytes);
      });

      child.stderr.on("data", (chunk) => {
        stderr = appendLimitedText(stderr, chunk, stderrMaxBytes);
      });

      child.on("error", (error) => {
        settle(() => reject(error));
      });

      child.on("close", (code) => {
        void (async () => {
          const cleanupResult = cleanupRequested
            ? await forceCleanupContainer(containerName)
            : null;
          const failure = classifyDockerFailure({
            stderr,
            exitCode: code,
            timedOut,
            aborted,
            cleanup: cleanupResult
          });

          settle(() => resolve({
            stdout,
            stderr,
            exitCode: code,
            timedOut,
            aborted,
            durationMs: Date.now() - startedAt,
            failure,
            cleanup: cleanupResult,
            image: this.image,
            containerName
          }));
        })().catch((error) => {
          settle(() => reject(error));
        });
      });
    });
  }
}
