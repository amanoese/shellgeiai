import { access, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function ensureDirectory(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

export async function fileExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRequestedWorkdir(requestedWorkdir: string | undefined) {
  if (requestedWorkdir) {
    const resolved = path.resolve(process.cwd(), requestedWorkdir);
    await ensureDirectory(resolved);
    return resolved;
  }

  return process.cwd();
}

export async function createWorkingDirectory() {
  return await mkdtemp(path.join(os.tmpdir(), "shellgeiai-"));
}

export async function writeJson(targetPath: string, value: unknown) {
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson(targetPath: string): Promise<unknown> {
  const content = await readFile(targetPath, "utf8");
  return JSON.parse(content);
}

export async function commandExists(command: string) {
  return (await findCommandPath(command)) != null;
}

export async function findCommandPath(command: string) {
  const pathValue = process.env.PATH ?? "";
  const directories = pathValue.split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    const candidate = path.join(directory, command);
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

/** Propagate cancellation even when an injected provider does not honor its signal. */
export function awaitWithSignal<T>(operation: () => T | PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return Promise.resolve().then(operation);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("Knowledge operation aborted."));
    signal.addEventListener("abort", aborted, { once: true });
    let result: T | PromiseLike<T>;
    try { result = operation(); } catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(value => {
      if (signal.aborted) aborted();
      else resolve(value);
    }, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

