import { access } from "node:fs/promises";
import path from "node:path";

export async function commandExists(command) {
  return (await findCommandPath(command)) != null;
}

export async function findCommandPath(command) {
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
