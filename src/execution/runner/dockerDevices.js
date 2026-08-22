import { stat } from "node:fs/promises";
import path from "node:path";

function assertDevicePathSyntax(devicePath) {
  if (typeof devicePath !== "string" || !path.isAbsolute(devicePath)) {
    throw new Error(
      `Docker device path "${String(devicePath)}" must be an absolute path under /dev.`
    );
  }

  const relative = path.relative("/dev", devicePath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Docker device path "${devicePath}" must be under /dev.`);
  }

  if (devicePath.includes(":")) {
    throw new Error(`Docker device path "${devicePath}" must not contain ':'.`);
  }

  if (/[\0\r\n]/u.test(devicePath)) {
    throw new Error(
      `Docker device path ${JSON.stringify(devicePath)} contains unsupported control characters.`
    );
  }
}

export async function normalizeReadonlyDockerDevices(
  devicePaths = [],
  { statPath = stat } = {}
) {
  const normalized = [];
  const seen = new Set();

  for (const devicePath of devicePaths) {
    assertDevicePathSyntax(devicePath);
    if (seen.has(devicePath)) {
      continue;
    }

    let metadata;
    try {
      metadata = await statPath(devicePath);
    } catch {
      throw new Error(
        `Docker device path "${devicePath}" does not exist or cannot be inspected.`
      );
    }

    if (!metadata.isBlockDevice() && !metadata.isCharacterDevice()) {
      throw new Error(
        `Docker device path "${devicePath}" must be a block or character device.`
      );
    }

    seen.add(devicePath);
    normalized.push(devicePath);
  }

  return normalized;
}
