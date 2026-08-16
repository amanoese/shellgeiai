import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const { execFile: actualExecFile } = await vi.importActual("node:child_process");
const execFileAsync = promisify(actualExecFile);

describe("npm publish metadata", () => {
  it("declares npm metadata for public release", () => {
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/amanoese/shellgeiai.git"
    });
    expect(packageJson.homepage).toBe("https://github.com/amanoese/shellgeiai#readme");
    expect(packageJson.bugs).toEqual({
      url: "https://github.com/amanoese/shellgeiai/issues"
    });
    expect(packageJson.author).toBe("amanoese");
    expect(packageJson.engines).toEqual({
      node: ">=20"
    });
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/"
 });
});

  it("limits publish files to runtime assets and package docs", () => {
    expect(packageJson.files).toEqual([
      "src",
      "scripts",
      "wasm",
      "policies",
      "data",
      "!data/knowledge/man.jsonl",
      "!data/knowledge/man.vectors.jsonl",
      "!data/knowledge/man.vectors.json",
      "README.md",
      "LICENSE"
    ]);
    expect(existsSync(path.join(repoRoot, "LICENSE"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "scripts/build-man-knowledge.js"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "data/knowledge/shellgei-man-profile.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "data/knowledge/shellgei-basic.vectors.jsonl"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "data/knowledge/shellgei-basic.vectors.json"))).toBe(false);
  });

  it("excludes locally generated man knowledge artifacts", () => {
    const ignoredPaths = readFileSync(path.join(repoRoot, ".gitignore"), "utf8").split(/\r?\n/);

    expect(ignoredPaths).toContain("data/knowledge/man.jsonl");
    expect(ignoredPaths).toContain("data/knowledge/man.vectors.jsonl");
    expect(ignoredPaths).toContain("data/knowledge/man.vectors.json");
  });

  it("exposes execution modules from the grouped src hierarchy", async () => {
    const modules = [
      "../src/execution/runner/localRunner.js",
      "../src/execution/runner/dockerRunner.js",
      "../src/execution/runner/limits.js",
      "../src/execution/safety/checker.js",
      "../src/execution/safety/policyLoader.js",
      "../src/execution/judge/simpleJudge.js"
    ];

    await Promise.all(modules.map((modulePath) => import(modulePath)));
  });

  it("exposes provider modules from the grouped src hierarchy", async () => {
    const modules = [
      "../src/providers/engines/Engine.js",
      "../src/providers/engines/openaiEngine.js",
      "../src/providers/engines/mockEngine.js",
      "../src/providers/engines/codexCliEngine.js",
      "../src/providers/engines/cursorCliEngine.js",
      "../src/providers/planner/llmPlanner.js",
      "../src/providers/planner/plannerPrompt.js",
      "../src/providers/planner/plannerSchema.js"
    ];

    await Promise.all(modules.map((modulePath) => import(modulePath)));
  });

  it("exposes io and shared modules from the grouped src hierarchy", async () => {
    const modules = [
      "../src/io/problem/parseProblem.js",
      "../src/io/logs/writer.js",
      "../src/io/logs/catalog.js",
      "../src/io/formatter/formatResult.js",
      "../src/io/formatter/logs.js",
      "../src/io/formatter/progressReporter.js",
      "../src/shared/fs.js",
      "../src/shared/exec.js"
    ];

 await Promise.all(modules.map((modulePath) => import(modulePath)));
 });

  it("exposes solve entry and session modules from the grouped src hierarchy", async () => {
  const modules = [
    "../src/solve/solve.js",
    "../src/solve/runtime.js",
    "../src/solve/session/solveSession.js",
 "../src/solve/session/sessionPhases.js",
 "../src/solve/session/progress.js",
 "../src/solve/session/types.js"
 ];

    await Promise.all(modules.map((modulePath) => import(modulePath)));
  });

  it("exposes solve flow modules from the grouped src hierarchy", async () => {
    const modules = [
      "../src/solve/orchestration/orchestrator.js",
      "../src/solve/orchestration/executionControl.js",
      "../src/solve/orchestration/executionSummary.js",
      "../src/solve/worker/executeWorkerTask.js",
      "../src/solve/worker/attemptRunner.js",
      "../src/solve/worker/attemptFactory.js",
      "../src/solve/worker/stopReason.js",
      "../src/solve/worker/taskExecutor.js",
      "../src/solve/worker/taskQueue.js",
      "../src/solve/planning/planner.js",
      "../src/solve/selection/selector.js",
      "../src/solve/scoring/shellgeiScorer.js"
    ];

    await Promise.all(modules.map((modulePath) => import(modulePath)));
  });

  it("includes Planner and Worker knowledge runtime modules in the packed files", async () => {
    const modulePaths = [
      "../src/knowledge/mode.js",
      "../src/knowledge/hints.js",
      "../src/tools/toolRegistry.js",
      "../src/knowledge/searchKnowledgeTool.js",
      "../src/solve/worker/toolLoop.js"
    ];
    const packedModulePaths = modulePaths.map((modulePath) => modulePath.replace(/^\.\.\//, ""));

    for (const modulePath of packedModulePaths) {
      expect(existsSync(path.resolve(repoRoot, modulePath))).toBe(true);
    }
    await Promise.all(modulePaths.map((modulePath) => import(modulePath)));

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-package-publish-"));
    const cacheDir = path.join(tempDir, "npm-cache");
    const packDir = path.join(tempDir, "pack-output");

    try {
      await mkdir(cacheDir);
      await mkdir(packDir);
      const { stdout } = await execFileAsync(
        "npm",
        ["pack", "--dry-run", "--json", "--pack-destination", packDir],
        {
          cwd: repoRoot,
          env: { ...process.env, npm_config_cache: cacheDir }
        }
      );
      const manifest = JSON.parse(stdout);
      expect(manifest).toHaveLength(1);
      const packedPaths = manifest[0].files.map((file) => file.path);

      for (const modulePath of packedModulePaths) {
        expect(packedPaths).toContain(modulePath);
      }
      expect(packedPaths).not.toContain("data/knowledge/man.jsonl");
      expect(packedPaths).not.toContain("data/knowledge/man.vectors.jsonl");
      expect(packedPaths).not.toContain("data/knowledge/man.vectors.json");
      expect((await readdir(packDir)).filter((name) => name.endsWith(".tgz"))).toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
