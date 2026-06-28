import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { showSavedLog } from "../src/io/logs/catalog.js";
import { solveProblem } from "../src/solve/solve.js";
import { SimpleJudge } from "../src/execution/judge/simpleJudge.js";
import { LocalRunner } from "../src/execution/runner/localRunner.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

const tempDirs = [];
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function createSolveLog(requestedWorkdir) {
  return await solveProblem({
    problemInput: "print ok",
    engine: {
      name: "test-engine",
      async generateCommand() {
        return {
          command: "printf 'ok\\n'",
          explanation: "Print ok."
        };
      }
    },
    runner: new LocalRunner(),
    judge: new SimpleJudge(),
    maxIterations: 1,
    plannerProvider: createTestPlannerProvider(),
    requestedWorkdir
  });
}

describe("showSavedLog", () => {
  it("restores a saved solve log from its full path", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-show-"));
    tempDirs.push(requestedWorkdir);

    const solved = await createSolveLog(requestedWorkdir);
    const restored = await showSavedLog(solved.logPath);

    expect(restored.command).toBe("printf 'ok\\n'");
    expect(restored.output).toBe("ok");
    expect(restored.finalCheck.passed).toBe(true);
    expect(restored.selector.name).toBe("first-pass-wins");
    expect(restored.logPath).toBe(path.resolve(process.cwd(), solved.logPath));
  });

  it("restores a saved solve log from a short log id in the logs directory", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-project-"));
    tempDirs.push(projectDir);
    process.chdir(projectDir);

    const solved = await createSolveLog(projectDir);
    const shortId = path.basename(solved.logPath, ".json").split("-").at(-1);
    const restored = await showSavedLog(shortId);

    expect(restored.command).toBe("printf 'ok\\n'");
    expect(restored.output).toBe("ok");
    expect(restored.finalCheck.passed).toBe(true);
  });
});
