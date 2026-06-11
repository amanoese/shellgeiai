import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { showSavedLog } from "../src/core/logsShow.js";
import { solveProblem } from "../src/core/solve.js";
import { SimpleJudge } from "../src/judge/simpleJudge.js";
import { LocalRunner } from "../src/runner/localRunner.js";

const tempDirs = [];
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("showSavedLog", () => {
  it("restores a saved solve log from its full path", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-show-"));
    tempDirs.push(requestedWorkdir);

    const solved = await solveProblem({
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
      requestedWorkdir
    });

    const restored = await showSavedLog(solved.logPath);

    expect(restored.command).toBe("printf 'ok\\n'");
    expect(restored.output).toBe("ok");
    expect(restored.finalCheck.passed).toBe(true);
    expect(restored.selector.name).toBe("first-pass-wins");
    expect(restored.logPath).toBe(path.resolve(process.cwd(), solved.logPath));
  });

  it("finds a saved log by run id", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-project-"));
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-show-"));
    tempDirs.push(projectDir);
    tempDirs.push(requestedWorkdir);
    process.chdir(projectDir);

    const solved = await solveProblem({
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
      requestedWorkdir
    });
    const logFilename = path.basename(solved.logPath, ".json");
    const runId = logFilename.replace(/^solve-/, "");

    const restored = await showSavedLog(runId);

    expect(restored.logPath).toBe(path.join(projectDir, "logs", `${logFilename}.json`));
    expect(restored.finalCheck.passed).toBe(true);
    expect(restored.problem.problemText).toBe("print ok");
  });
});
