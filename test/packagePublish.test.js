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
      "src",
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
      "../src/providers/planner/plannerSchema.js",
      "../src/providers/llm/config.js",
      "../src/providers/llm/client.js",
      "../src/providers/llm/responsesHistory.js"
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

  it("includes LLM, Planner and Worker knowledge runtime modules in the packed files", async () => {
    const modulePaths = [
      "../src/knowledge/mode.js",
      "../src/knowledge/hints.js",
      "../src/knowledge/knowledgePaths.js",
      "../src/knowledge/knowledgeRuntime.js",
      "../src/knowledge/embeddingInputs.js",
      "../src/knowledge/sqliteStore.js",
      "../src/knowledge/sqliteSchema.js",
      "../src/providers/embeddings/openRouterEmbedder.js",
      "../src/tools/toolRegistry.js",
      "../src/knowledge/searchKnowledgeTool.js",
      "../src/solve/worker/toolLoop.js",
      "../src/providers/llm/config.js",
      "../src/providers/llm/client.js",
      "../src/providers/llm/responsesHistory.js",
      "../src/providers/planner/llmPlanner.js",
      "../src/providers/engines/openaiEngine.js"
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
        ["pack", "--dry-run", "--json", "--pack-destination", packDir],
        {
          cwd: repoRoot,
          encoding: "utf8",
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
      expect(packedPaths).toContain("data/knowledge/shellgei-basic.jsonl");
      expect(packedPaths).not.toContain("data/knowledge/shellgei-basic.vectors.jsonl");
      for (const artifact of generatedArtifacts) expect(packedPaths).not.toContain(path.relative(repoRoot, artifact));
      for (const legacy of ["ruriEmbedder.js", "vectorFile.js", "vectorSearch.js"]) {
        expect(packedPaths).not.toContain(`src/knowledge/${legacy}`);
      }
      expect((await readdir(packDir)).filter((name) => name.endsWith(".tgz"))).toEqual([]);
    } finally {
      for (const artifact of createdArtifacts) await rm(artifact, { force: true });
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
