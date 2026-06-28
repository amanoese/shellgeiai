import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeCommand } from "../src/execution/safety/checker.js";
import { loadCommandPolicy, loadSandboxPolicy } from "../src/execution/safety/policyLoader.js";

describe("isSafeCommand", () => {
  it("allows simple awk command", async () => {
    await expect(isSafeCommand("awk -F, '{s+=$3} END{print s}' sample.csv")).resolves.toEqual({ safe: true });
  });

  it("blocks dangerous commands from AST command names", async () => {
    await expect(isSafeCommand("rm -rf /tmp/work")).resolves.toEqual({
      safe: false,
      reason: "Blocked dangerous command: rm"
    });
  });

  it("allows language one-liners but blocks sensitive redirects", async () => {
    await expect(isSafeCommand("python3 -c 'print(1)'")).resolves.toEqual({ safe: true });
    await expect(isSafeCommand("node -pe 'JSON.parse($0).name'")).resolves.toEqual({ safe: true });
    await expect(isSafeCommand("echo ok > /etc/passwd")).resolves.toEqual({
      safe: false,
      reason: "Blocked redirection to sensitive path: /etc/passwd"
    });
    await expect(isSafeCommand("echo ok >> '$HOME/result'")).resolves.toEqual({
      safe: false,
      reason: "Blocked redirection to sensitive path: $HOME/result"
    });
    await expect(isSafeCommand("echo ok > ~/result")).resolves.toEqual({
      safe: false,
      reason: "Blocked redirection to sensitive path: ~/result"
    });
  });

  it("blocks recursive background shell functions independent of function name", async () => {
    await expect(isSafeCommand("boom(){ boom|boom& }; boom")).resolves.toEqual({
      safe: false,
      reason: "Blocked recursive background shell function: boom"
    });
    await expect(isSafeCommand(":(){ :|:& };:")).resolves.toEqual({
      safe: false,
      reason: "Blocked recursive background shell function: :"
    });
  });

  it("allows recursive shell functions without background execution", async () => {
    await expect(isSafeCommand("loop(){ echo '&'; loop; }; loop")).resolves.toEqual({ safe: true });
  });

  it("loads external structured command policy file and replaces defaults", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-safety-"));
    const policyPath = path.join(tempDir, "command-policy.json");

    try {
      await writeFile(
        policyPath,
        JSON.stringify(
          {
            blockedCommands: [{ name: "awk", reason: "Blocked command: awk" }]
          },
          null,
          2
        )
      );

      const policy = await loadCommandPolicy(policyPath);
      await expect(isSafeCommand("awk '{print $1}' sample.txt", policy)).resolves.toEqual({
        safe: false,
        reason: "Blocked command: awk"
      });
      await expect(isSafeCommand("rm -rf /tmp/work", policy)).resolves.toEqual({ safe: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("policy loaders", () => {
  it("loads external sandbox policy file overlays defaults", async () => {
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

  it("rejects legacy regex command policy files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-safety-"));
    const policyPath = path.join(tempDir, "legacy-command-policy.json");

    try {
      await writeFile(
        policyPath,
        JSON.stringify(
          {
            blockedPatterns: [{ pattern: "awk", reason: "Blocked command: awk" }]
          },
          null,
          2
        )
      );

      await expect(loadCommandPolicy(policyPath)).rejects.toThrow(/blockedPatterns/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects unknown keys in command policy file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-safety-"));
    const policyPath = path.join(tempDir, "unknown-command-policy.json");

    try {
      await writeFile(
        policyPath,
        JSON.stringify(
          {
            blockedCommands: [],
            extraField: true
          },
          null,
          2
        )
      );

      await expect(loadCommandPolicy(policyPath)).rejects.toThrow(/extraField/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid blocked command entries in command policy file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-safety-"));
    const policyPath = path.join(tempDir, "invalid-command-policy.json");

    try {
      await writeFile(
        policyPath,
        JSON.stringify(
          {
            blockedCommands: [{ name: "awk", reason: "   " }]
          },
          null,
          2
        )
      );

      await expect(loadCommandPolicy(policyPath)).rejects.toThrow(/blockedCommands\.0\.reason/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects unknown keys in sandbox policy file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-safety-"));
    const policyPath = path.join(tempDir, "unknown-sandbox-policy.json");

    try {
      await writeFile(
        policyPath,
        JSON.stringify(
          {
            networkAccess: "off",
            extraField: "surprise"
          },
          null,
          2
        )
      );

      await expect(loadSandboxPolicy(policyPath)).rejects.toThrow(/extraField/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
