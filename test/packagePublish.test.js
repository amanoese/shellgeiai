import { existsSync, readFileSync } from "node:fs";
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
      node: ">=20"
    });
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/"
    });
  });

  it("limits publish files to runtime assets and package docs", () => {
    expect(packageJson.files).toEqual(["src", "policies", "README.md", "LICENSE"]);
    expect(existsSync(path.join(repoRoot, "LICENSE"))).toBe(true);
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
});
