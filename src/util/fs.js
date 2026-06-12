import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function fileExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRequestedWorkdir(requestedWorkdir) {
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

export async function writeJson(targetPath, value) {
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson(targetPath) {
  const content = await readFile(targetPath, "utf8");
  return JSON.parse(content);
}
