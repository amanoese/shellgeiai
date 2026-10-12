import type { Runner, RunOptions, RunResult, RunnerFailure, RunnerCleanup, RunnerLimits, SandboxPolicy } from "../types.js";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { commandExists } from "../shared.js";
import { stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_IMAGE = process.env.SHELLGEIAI_DOCKER_IMAGE ?? "theoldmoon0602/shellgeibot";

const CONTAINER_WORKDIR = "/workspace";

function createContainerName() {
    return `shellgeiai-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function summarizeStderr(stderr: string) {
    const line = stderr
        .split("\n")
        .map((item) => item.trim())
        .find(Boolean) ?? "";
    return line.replace("response from daemon", "response daemon");
}

function classifyDockerFailure({ stderr, exitCode, timedOut, aborted, cleanup }: Pick<RunResult, "stderr" | "exitCode" | "timedOut" | "aborted" | "cleanup">): RunnerFailure | null {
    if (cleanup?.attempted && cleanup.exitCode !== 0) {
        return {
            type: "container-cleanup-failed",
            message: summarizeStderr(cleanup.stderr) ||
                "Docker cleanup failed without stderr output."
        };
    }
    if (timedOut || aborted || exitCode == null || exitCode === 0) {
        return null;
    }
    const message = summarizeStderr(stderr);
    if (!message) {
        return null;
    }
    if (exitCode === 125 &&
        /(failed to remove|failed remove|error removing|cleanup|cannot remove container)/i.test(message)) {
        return { type: "container-cleanup-failed", message };
    }
    return { type: "docker-cli-error", message };
}

function bytesToDockerMemory(memoryMaxBytes: number | undefined) {
    if (!memoryMaxBytes) {
        return null;
    }
    return `${Math.ceil(memoryMaxBytes / (1024 * 1024))}m`;
}

function truncateOutput(current: string, chunk: Buffer, maxBytes: number | undefined) {
    const next = current + chunk.toString();
    if (!maxBytes) {
        return next;
    }
    if (Buffer.byteLength(next) <= maxBytes) {
        return next;
    }
    return next.slice(0, maxBytes);
}

async function forceCleanupContainer(containerName: string): Promise<RunnerCleanup> {
    return await new Promise<RunnerCleanup>((resolve) => {
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
        child.on("close", (exitCode) => {
            resolve({
                attempted: true,
                exitCode,
                stderr
            });
        });
    });
}

export function buildDockerRunArgs(command: string, options: RunOptions, config: { image?: string; containerName?: string } = {}) {
    const limits: Partial<RunnerLimits> = options.limits ?? {};
    const sandboxPolicy: Partial<SandboxPolicy> = options.sandboxPolicy ?? {};
    const image = config.image ?? DEFAULT_IMAGE;
    const containerName = config.containerName ?? createContainerName();
    const mountMode = options.writableWorkdir ? "rw" : "ro";
    const args = [
        "run",
        "--rm",
        "--name",
        containerName,
        "--workdir",
        CONTAINER_WORKDIR,
        "--volume",
        `${options.cwd}:${CONTAINER_WORKDIR}:${mountMode}`
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
    for (const devicePath of options.dockerDevicesReadonly ?? []) {
        args.push("--device", `${devicePath}:${devicePath}:r`);
    }
    args.push(image, "/bin/bash", "--noprofile", "--norc", "-lc", command);
    return args;
}

export class DockerRunner implements Runner {
    image: string;
    name = "docker";
    constructor(config: { image?: string } = {}) {
        this.image = config.image ?? DEFAULT_IMAGE;
    }
    async run(command: string, options: RunOptions): Promise<RunResult> {
        if (!(await commandExists("docker"))) {
            throw new Error("Docker runner was requested, but 'docker' command is not available. Install Docker or use --runner local.");
        }
        const args = buildDockerRunArgs(command, options, { image: this.image });
        const timeoutMs = options.timeoutMs ?? options.limits?.wallClockMs ?? 5000;
        const stdoutMaxBytes = options.limits?.stdoutMaxBytes;
        const stderrMaxBytes = options.limits?.stderrMaxBytes;
        const containerNameIndex = args.indexOf("--name");
        const containerName = containerNameIndex >= 0 ? args[containerNameIndex + 1] : createContainerName();
        return await new Promise<RunResult>((resolve, reject) => {
            const startedAt = Date.now();
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
            const cleanupListeners = () => {
                clearTimeout(timer);
                if (options.signal) {
                    options.signal.removeEventListener("abort", handleAbort);
                }
            };
            const settle = (callback: () => void) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanupListeners();
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
            }
            else if (options.signal) {
                options.signal.addEventListener("abort", handleAbort, { once: true });
            }
            child.stdout.on("data", (chunk) => {
                stdout = truncateOutput(stdout, chunk, stdoutMaxBytes);
            });
            child.stderr.on("data", (chunk) => {
                stderr = truncateOutput(stderr, chunk, stderrMaxBytes);
            });
            child.on("error", (error) => {
                settle(() => reject(error));
            });
            child.on("close", async (exitCode) => {
                let cleanup = null;
                if (cleanupRequested) {
                    cleanup = await forceCleanupContainer(containerName);
                }
                const result: RunResult = {
                    stdout,
                    stderr,
                    exitCode,
                    timedOut,
                    aborted,
                    durationMs: Date.now() - startedAt,
                    cleanup,
                    failure: null,
                    image: this.image,
                    containerName
                };
                result.failure = classifyDockerFailure({
                    stderr,
                    exitCode,
                    timedOut,
                    aborted,
                    cleanup
                });
                settle(() => resolve(result));
            });
        });
    }
}

function assertDevicePathSyntax(devicePath: string) {
    if (typeof devicePath !== "string" || !path.isAbsolute(devicePath)) {
        throw new Error(`Docker device path "${String(devicePath)}" must be an absolute path under /dev.`);
    }
    const relative = path.relative("/dev", devicePath);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`Docker device path "${devicePath}" must be under /dev.`);
    }
    if (devicePath.includes(":")) {
        throw new Error(`Docker device path "${devicePath}" must not contain ':'.`);
    }
    if (/[\0\r\n]/u.test(devicePath)) {
        throw new Error(`Docker device path ${JSON.stringify(devicePath)} contains unsupported control characters.`);
    }
}

export async function normalizeReadonlyDockerDevices(devicePaths: string[] = [], { statPath = stat }: { statPath?: (path: string) => Promise<Pick<import("node:fs").Stats, "isBlockDevice" | "isCharacterDevice">> } = {}) {
    const normalized: string[] = [];
    const seen = new Set();
    for (const devicePath of devicePaths) {
        assertDevicePathSyntax(devicePath);
        if (seen.has(devicePath)) {
            continue;
        }
        let metadata;
        try {
            metadata = await statPath(devicePath);
        }
        catch {
            throw new Error(`Docker device path "${devicePath}" does not exist or cannot be inspected.`);
        }
        if (!metadata.isBlockDevice() && !metadata.isCharacterDevice()) {
            throw new Error(`Docker device path "${devicePath}" must be a block or character device.`);
        }
        seen.add(devicePath);
        normalized.push(devicePath);
    }
    return normalized;
}
