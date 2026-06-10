import { spawn } from "node:child_process";
import { commandExists } from "../util/exec.js";

const DEFAULT_IMAGE = process.env.SHELLGEIAI_DOCKER_IMAGE ?? "ubuntu:24.04";
const CONTAINER_WORKDIR = "/workspace";

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
  const args = [
    "run",
    "--rm",
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
        child.kill("SIGKILL");
      }, timeoutMs);

      const handleAbort = () => {
        aborted = true;
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
        settle(() => resolve({
          stdout,
          stderr,
          exitCode: code,
          timedOut,
          aborted,
          durationMs: Date.now() - startedAt
        }));
      });
    });
  }
}
