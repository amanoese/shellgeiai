import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

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
      node: ">=22"
    });
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/"
 });
});

  it("limits publish files to runtime assets and package docs", () => {
    expect(packageJson.files).toEqual([
      "dist",
      "scripts",
      "wasm",
      "policies",
      "data",
      "!data/knowledge/man.jsonl",
      "!data/knowledge/man.vectors.jsonl",
      "!data/knowledge/man.vectors.json",
      "!**/*.sqlite",
      "!**/*.sqlite-*",
      "!**/*.sqlite3",
      "!**/*.sqlite3-*",
      "!**/*.db",
      "!**/*.db-*",
      "README.md",
      "LICENSE"
    ]);
    expect(packageJson.bin.shellgeiai).toBe("dist/cli.js");
    expect(packageJson.scripts.prepack).toBe("npm run build");
    expect(existsSync(path.join(repoRoot, "LICENSE"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "scripts/build-man-knowledge.js"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "data/knowledge/shellgei-man-profile.json"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "data/knowledge/shellgei-basic.jsonl"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "data/knowledge/shellgei-basic.vectors.jsonl"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "data/knowledge/shellgei-basic.vectors.json"))).toBe(false);
  });

  it("excludes locally generated man knowledge artifacts", () => {
    const ignoredPaths = readFileSync(path.join(repoRoot, ".gitignore"), "utf8").split(/\r?\n/);

    expect(ignoredPaths).toContain("data/knowledge/man.jsonl");
    expect(ignoredPaths).toContain("data/knowledge/man.vectors.jsonl");
    expect(ignoredPaths).toContain("data/knowledge/man.vectors.json");
  });

  it("publishes consolidated shared, type, event and shell analysis modules", async () => {
    const modules = ["../dist/types.js", "../dist/shared.js", "../dist/solve/events.js", "../dist/shell/analyzer.js"];
    const exports = await Promise.all(modules.map((modulePath) => import(modulePath)));
    expect(Object.keys(exports[0])).toEqual([]);
    for (const oldPath of [
      "dist/solve/session/types.js", "dist/providers/engines/Engine.js",
      "dist/execution/runner/Runner.js", "dist/execution/judge/Judge.js",
      "dist/shared/fs.js", "dist/shared/exec.js", "dist/solve/session/progress.js",
      "dist/solve/session/sessionPhases.js", "dist/solve/scoring/commandAnalyzer.js",
      "dist/solve/scoring/treeSitterLoader.js"
    ]) expect(existsSync(path.join(repoRoot, oldPath))).toBe(false);
  });

  it("exposes execution modules from the grouped dist hierarchy", async () => {
    const modules = [
      "../dist/execution/localRunner.js",
      "../dist/execution/dockerRunner.js",
      "../dist/execution/safety.js",
      "../dist/execution/safety.js",
      "../dist/execution/safety.js",
      "../dist/execution/judge.js"
    ];

    await Promise.all(modules.map((modulePath) => import(modulePath)));
  });

  it("exposes provider modules from the grouped dist hierarchy", async () => {
    const modules = [
      "../dist/providers/apiEngine.js",
      "../dist/providers/engines.js",
      "../dist/providers/engines.js",
      "../dist/providers/engines.js",
      "../dist/providers/planner.js",
      "../dist/providers/planner.js",
      "../dist/providers/planner.js",
      "../dist/providers/llm.js",
      "../dist/providers/llm.js",
      "../dist/providers/llm.js"
    ];

    await Promise.all(modules.map((modulePath) => import(modulePath)));
  });

  it("exposes io and shared modules from the grouped dist hierarchy", async () => {
    const modules = [
      "../dist/io/problem/parseProblem.js",
      "../dist/io/logs/writer.js",
      "../dist/io/logs/catalog.js",
      "../dist/io/formatter/formatResult.js",
      "../dist/io/formatter/logs.js",
      "../dist/io/formatter/progressReporter.js",
      "../dist/shared.js"
    ];

 await Promise.all(modules.map((modulePath) => import(modulePath)));
 });

  it("exposes solve entry and session modules from the grouped dist hierarchy", async () => {
  const modules = [
    "../dist/solve/solve.js",
    "../dist/solve/runtime.js",
    "../dist/solve/session/solveSession.js",
 "../dist/solve/events.js",
 "../dist/types.js"
 ];

    await Promise.all(modules.map((modulePath) => import(modulePath)));
  });

  it("exposes solve flow modules from the grouped dist hierarchy", async () => {
    const modules = [
      "../dist/solve/orchestration/orchestrator.js",
      "../dist/solve/orchestration/executionControl.js",
      "../dist/solve/orchestration/executionSummary.js",
      "../dist/solve/worker.js",
      "../dist/solve/tools.js",
      "../dist/solve/worker/taskQueue.js",
      "../dist/solve/planning/planner.js",
      "../dist/solve/selection/selector.js",
      "../dist/solve/scoring/shellgeiScorer.js"
    ];

    await Promise.all(modules.map((modulePath) => import(modulePath)));
    for (const oldPath of [
      "dist/solve/worker/executeWorkerTask.js", "dist/solve/worker/attemptRunner.js",
      "dist/solve/worker/attemptFactory.js", "dist/solve/worker/stopReason.js",
      "dist/solve/worker/taskExecutor.js", "dist/solve/worker/toolLoop.js",
      "dist/tools/toolRegistry.js"
    ]) expect(existsSync(path.join(repoRoot, oldPath))).toBe(false);
  });

  it("includes LLM, Planner and Worker knowledge runtime modules in the packed files", async () => {
    const modulePaths = [
      "../dist/types.js",
      "../dist/shared.js",
      "../dist/solve/events.js",
      "../dist/shell/analyzer.js",
      "../dist/knowledge/mode.js",
      "../dist/knowledge/hints.js",
      "../dist/knowledge/knowledgePaths.js",
      "../dist/knowledge/knowledgeRuntime.js",
      "../dist/knowledge/embeddingInputs.js",
      "../dist/knowledge/sqliteStore.js",
      "../dist/knowledge/sqliteSchema.js",
      "../dist/providers/embedder.js",
      "../dist/solve/tools.js",
      "../dist/knowledge/searchKnowledgeTool.js",
      "../dist/providers/llm.js",
      "../dist/providers/llm.js",
      "../dist/providers/llm.js",
      "../dist/providers/planner.js",
      "../dist/providers/apiEngine.js"
    ];
    const packedModulePaths = modulePaths.map((modulePath) => modulePath.replace(/^\.\.\//, ""));

    for (const modulePath of packedModulePaths) {
      expect(existsSync(path.resolve(repoRoot, modulePath))).toBe(true);
    }
    await Promise.all(modulePaths.map((modulePath) => import(modulePath)));

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-package-publish-"));
    const cacheDir = path.join(tempDir, "npm-cache");
    const packDir = path.join(tempDir, "pack-output");
    const generatedArtifacts = [".sqlite", ".sqlite-wal", ".sqlite-shm", ".db", ".db-wal", ".db-shm", ".sqlite3", ".sqlite3-wal"]
      .map((extension) => path.join(repoRoot, "data/knowledge", `${path.basename(tempDir)}${extension}`));
    const createdArtifacts = [];

    try {
      await mkdir(cacheDir);
      await mkdir(packDir);
      for (const artifact of generatedArtifacts) {
        await writeFile(artifact, "test generated database", { flag: "wx" });
        createdArtifacts.push(artifact);
      }
      const stdout = execFileSync(
        "npm",
        // npm test already built dist; prepack would delete modules used by parallel tests.
        ["pack", "--dry-run", "--ignore-scripts", "--json", "--pack-destination", packDir],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...process.env, npm_config_cache: cacheDir }
        }
      );
      const manifest = JSON.parse(stdout);
      expect(manifest).toHaveLength(1);
      const packedPaths = manifest[0].files.map((file) => file.path);

      expect(packedPaths).toContain("dist/cli.js");
      expect(packedPaths.some((filePath) => filePath.startsWith("src/"))).toBe(false);
      for (const modulePath of packedModulePaths) {
        expect(packedPaths).toContain(modulePath);
      }
      expect(packedPaths).not.toContain("data/knowledge/man.jsonl");
      expect(packedPaths).not.toContain("data/knowledge/man.vectors.jsonl");
      expect(packedPaths).not.toContain("data/knowledge/man.vectors.json");
      expect(packedPaths).toContain("data/knowledge/shellgei-basic.jsonl");
      expect(packedPaths).not.toContain("data/knowledge/shellgei-basic.vectors.jsonl");
      for (const artifact of generatedArtifacts) expect(packedPaths).not.toContain(path.relative(repoRoot, artifact));
      for (const legacy of ["ruriEmbedder.js", "vectorFile.js", "vectorSearch.js"]) {
        expect(packedPaths).not.toContain(`dist/knowledge/${legacy}`);
      }
      expect((await readdir(packDir)).filter((name) => name.endsWith(".tgz"))).toEqual([]);
    } finally {
      for (const artifact of createdArtifacts) await rm(artifact, { force: true });
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
