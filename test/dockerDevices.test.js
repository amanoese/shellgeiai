import { describe, expect, it, vi } from "vitest";

import { normalizeReadonlyDockerDevices } from "../src/execution/runner/dockerDevices.js";

const blockDevice = {
  isBlockDevice: () => true,
  isCharacterDevice: () => false
};
const characterDevice = {
  isBlockDevice: () => false,
  isCharacterDevice: () => true
};
const regularFile = {
  isBlockDevice: () => false,
  isCharacterDevice: () => false
};

describe("normalizeReadonlyDockerDevices", () => {
  it("keeps valid block and character devices in first-occurrence order", async () => {
    const statPath = vi.fn(async (devicePath) =>
      devicePath === "/dev/loop40" ? blockDevice : characterDevice
    );

    await expect(
      normalizeReadonlyDockerDevices(
        ["/dev/loop40", "/dev/null", "/dev/loop40"],
        { statPath }
      )
    ).resolves.toEqual(["/dev/loop40", "/dev/null"]);
    expect(statPath).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["loop40", "absolute path under /dev"],
    ["/tmp/loop40", "under /dev"],
    ["/dev/loop:40", "must not contain ':'"],
    ["/dev/loop40\n", "control characters"]
  ])("rejects invalid path %j", async (devicePath, message) => {
    await expect(
      normalizeReadonlyDockerDevices([devicePath], { statPath: vi.fn() })
    ).rejects.toThrow(message);
  });

  it("rejects missing devices with the path in the error", async () => {
    const statPath = vi.fn(async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    });

    await expect(
      normalizeReadonlyDockerDevices(["/dev/missing"], { statPath })
    ).rejects.toThrow("/dev/missing");
  });

  it("rejects regular files", async () => {
    await expect(
      normalizeReadonlyDockerDevices(["/dev/not-a-device"], {
        statPath: vi.fn(async () => regularFile)
      })
    ).rejects.toThrow("block or character device");
  });
});
