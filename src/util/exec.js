import { access } from "node:fs/promises";
import path from "node:path";

export async function commandExists(command) {
  const pathValue = process.env.PATH ?? "";
  const directories = pathValue.split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    const candidate = path.join(directory, command);
    try {
      await access(candidate);
      return true;
    } catch {
      continue;
    }
  }

  return false;
}
