import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeCommand } from "../src/safety/checker.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../src/safety/policyLoader.js";

describe("isSafeCommand", () => {
  it("allows a simple awk command", () => {
    expect(isSafeCommand("awk -F, '{s+=$3} END{print s}' sample.csv")).toEqual({ safe: true });
  });

  it("blocks dangerous commands", () => {
    expect(isSafeCommand("rm -rf /tmp/work")).toEqual({
      safe: false,
      reason: "Blocked dangerous command: rm"
    });
  });

  it("loads an external command policy file and merges it with defaults", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-safety-"));
    const policyPath = path.join(tempDir, "command-policy.json");

    try {
      await writeFile(
        policyPath,
        JSON.stringify(
          {
            blockedPatterns: [{ pattern: "(^|[^\\w])(awk)(\\s|$)", reason: "Blocked command: awk" }]
          },
          null,
          2
        )
      );

      const policy = await loadCommandPolicy(policyPath);
      expect(isSafeCommand("awk '{print $1}' sample.txt", policy)).toEqual({
        safe: false,
        reason: "Blocked command: awk"
      });
      expect(isSafeCommand("rm -rf /tmp/work", policy)).toEqual({
        safe: false,
        reason: "Blocked dangerous command: rm"
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("loads an external sandbox policy file and overlays defaults", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-safety-"));
    const policyPath = path.join(tempDir, "sandbox-policy.json");

    try {
      await writeFile(
        policyPath,
        JSON.stringify(
          {
            filesystemScope: "readonly-workdir"
          },
          null,
          2
        )
      );

      await expect(loadSandboxPolicy(policyPath)).resolves.toEqual({
        networkAccess: "off",
        filesystemScope: "readonly-workdir"
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails clearly when a command policy regex is invalid", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-safety-"));
    const policyPath = path.join(tempDir, "bad-command-policy.json");

    try {
      await writeFile(
        policyPath,
        JSON.stringify(
          {
            blockedPatterns: [{ pattern: "[", reason: "bad regex" }]
          },
          null,
          2
        )
      );

      await expect(loadCommandPolicy(policyPath)).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
