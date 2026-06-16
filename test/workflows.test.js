import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readWorkflow(name) {
  return readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8");
}

describe("GitHub workflows", () => {
  it("runs CI pushes against master", () => {
    const ciWorkflow = readWorkflow("ci.yml");

    expect(ciWorkflow).toContain("push:");
    expect(ciWorkflow).toContain("branches:");
    expect(ciWorkflow).toContain("- master");
    expect(ciWorkflow).not.toContain("- main");
  });

  it("checks pull requests bump package version over master", () => {
    const workflow = readWorkflow("version-check.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("- master");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("origin/master:package.json");
    expect(workflow).toContain("sort -V");
    expect(workflow).toContain("BASE_VERSION");
    expect(workflow).toContain("HEAD_VERSION");
    expect(workflow).toContain("echo -e");
    expect(workflow).toContain("Version bump required:");
    expect(workflow).not.toContain("plain semver");
    expect(workflow).not.toContain("=~");
    expect(workflow).not.toContain("printf");
  });
});
