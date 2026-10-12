import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { showSavedLog } from "../dist/io/logs.js";
import { solveProblem } from "../dist/solve/solve.js";
import { SimpleJudge } from "../dist/execution/judge.js";
import { LocalRunner } from "../dist/execution/localRunner.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";
import { writeJson } from "../dist/shared.js";
import { formatResult } from "../dist/cli/commands.js";

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
  it("restores sparse legacy logs and preserves non-string metadata in output", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-legacy-"));
    tempDirs.push(logsDir);
    const logPath = path.join(logsDir, "check-legacy.json");
    await writeJson(logPath, {
      command: "printf 42", explanation: 42, engine: 7,
      attempts: [{ command: "printf 42" }],
      selector: { name: 8, reason: 9 },
      plan: { planner: { provider: 10, attemptedProvider: 11, fallbackReason: 12 } },
      problemSpec: { problemText: "print 42", metadata: { custom: 13 } }
    });

    const restored = await showSavedLog(logPath);
    expect(restored.finalCheck).toMatchObject({ passed: false, iterations: 1, engine: 7 });
    expect(restored.problem.metadata).toEqual({ custom: 13 });
    const output = formatResult(restored);
    expect(output).toContain("EXPLANATION:\n42");
    expect(output).toContain("selector: 8");
    expect(output).toContain("selector-reason: 9");
    expect(output).toContain("planner-provider: 10");
    expect(output).toContain("planner-attempted-provider: 11");
    expect(output).toContain("planner-fallback-reason: 12");
  });

  it("rejects malformed saved candidate containers before traversing them", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-invalid-"));
    tempDirs.push(logsDir);
    const logPath = path.join(logsDir, "solve-invalid.json");
    await writeJson(logPath, { candidates: [null] });

    await expect(showSavedLog(logPath)).rejects.toThrow("Invalid saved log structure:");
  });

  it("keeps the fallback for legacy selector values without object fields", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-selector-"));
    tempDirs.push(logsDir);
    const logPath = path.join(logsDir, "check-selector.json");
    await writeJson(logPath, {
      selector: "legacy-selector", selectedCandidateId: "candidate-2",
      candidates: [
        { candidateId: "candidate-1", command: "printf 1" },
        { candidateId: "candidate-2", command: "printf 2", finalCheck: { passed: true } }
      ]
    });

    const restored = await showSavedLog(logPath);
    expect(restored.command).toBe("printf 2");
    expect(restored.selector).toMatchObject({
      name: "first-pass-wins", selectedCandidateId: "candidate-2", reason: `Loaded saved log ${logPath}.`
    });
  });

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
