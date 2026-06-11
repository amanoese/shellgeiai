import { spawn } from "node:child_process";
import { findCommandPath } from "../util/exec.js";

let cachedShellPath;

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

async function resolveShell() {
  if (cachedShellPath) {
    return cachedShellPath;
  }

  cachedShellPath = (await findCommandPath("bash")) ?? (await findCommandPath("sh"));
  if (!cachedShellPath) {
    throw new Error("Local runner requires a POSIX shell, but neither 'bash' nor 'sh' was found in PATH.");
  }

  return cachedShellPath;
}

export class LocalRunner {
  name = "local";

  async run(command, options) {
    const shellPath = await resolveShell();
    const shellArgs = shellPath.endsWith("/bash") ? ["--noprofile", "--norc", "-lc", command] : ["-lc", command];

    return await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timeoutMs = options.timeoutMs ?? options.limits?.wallClockMs ?? 5_000;
      const stdoutMaxBytes = options.limits?.stdoutMaxBytes;
      const stderrMaxBytes = options.limits?.stderrMaxBytes;
      const child = spawn(shellPath, shellArgs, {
        cwd: options.cwd,
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
