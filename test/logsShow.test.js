import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { showSavedLog } from "../src/io/logs/catalog.js";
import { solveProblem } from "../src/solve/solve.js";
import { SimpleJudge } from "../src/execution/judge/simpleJudge.js";
import { LocalRunner } from "../src/execution/runner/localRunner.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";
import { formatResult } from "../src/io/formatter/formatResult.js";

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
    expect(restored.shellgeiScoreVersion).toBe("length-artistry-v1");
    expect(restored.candidates).toEqual(solved.candidates);
    expect(restored.selector.metrics.selectedDurationMs).toBe(solved.selector.metrics.selectedDurationMs);
    const selected = restored.candidates.find(candidate => candidate.candidateId === restored.selector.selectedCandidateId);
    expect(restored.selector.metrics.totalScore).toBe(selected.shellgeiScore.value);
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

  it("restores legacy scores without recalculating or relabeling their breakdown", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-legacy-log-"));
    tempDirs.push(dir);
    const score = { value: 72, mode: "artistry", breakdown: {
      conciseness: 13, shellness: 14, ingenuity: 12, readability: 11, robustness: 12, artistry: 10
    } };
    const logPath = path.join(dir, "legacy.json");
    await writeFile(logPath, JSON.stringify({
      selectedCandidateId: "old", candidates: [{ candidateId: "old", command: "printf 42", shellgeiScore: score, finalCheck: { passed: true } }]
    }));
    const restored = await showSavedLog(logPath);
    expect(restored.candidates[0].shellgeiScore).toEqual(score);
    const output = formatResult(restored);
    expect(output).toContain("selected-shellgei-score: 72");
    expect(output).toContain("shellgei-score-version: legacy");
    expect(output).toContain("ingenuity=12");
    expect(output).toContain("robustness=12");
    expect(output).not.toContain("performance-ms:");
  });
});
