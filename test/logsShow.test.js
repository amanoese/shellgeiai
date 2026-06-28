import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
      plannerProvider: createTestPlannerProvider(),
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
      plannerProvider: createTestPlannerProvider(),
      requestedWorkdir
    });
    const logFilename = path.basename(solved.logPath, ".json");
    const runId = logFilename.replace(/^solve-/, "");

    const restored = await showSavedLog(runId);

    expect(restored.logPath).toBe(path.join(projectDir, "logs", `${logFilename}.json`));
    expect(restored.finalCheck.passed).toBe(true);
    expect(restored.problem.problemText).toBe("print ok");
  });

  it("uses replay selection metadata when restoring a replay log", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-logs-project-"));
    tempDirs.push(projectDir);
    process.chdir(projectDir);

    const logsDir = path.join(projectDir, "logs");
    const logPath = path.join(logsDir, "replay-2026-06-12T12-00-00-000Z.json");
    await mkdir(logsDir, { recursive: true });
    await writeFile(
      logPath,
      `${JSON.stringify(
        {
          mode: "replay",
          problem: "print ok",
          problemSpec: {
            raw: "print ok",
            problemText: "print ok",
            metadata: {
              format: "plain-text"
            }
          },
          sourceLogPath: "/tmp/source-solve.json",
          replayTarget: {
            kind: "candidate",
            id: "worker-1",
            command: "printf 'ok\\n'",
            explanation: "Print ok.",
            sourceCandidateId: "worker-1",
            sourceSelectedCandidateId: "worker-1",
            selectionReason: "Selected candidate 'worker-1' because it was selected in the source log."
          },
          attempts: [
            {
              attemptId: "worker-1-attempt-1",
              workerId: "worker-1",
              command: "printf 'ok\\n'",
              stdout: "ok\n",
              stderr: "",
              exitCode: 0,
              passed: true,
              timedOut: false,
              aborted: false,
              explanation: "Print ok.",
              durationMs: 1,
              score: {
                value: 100,
                breakdown: {
                  correctness: 60,
                  stdoutQuality: 15,
                  stderrQuality: 10,
                  expectedOutput: 15
                }
              },
              runnerFailure: null,
              runnerCleanup: null
            }
          ],
          candidates: [
            {
              candidateId: "worker-1",
              workerId: "worker-1",
              strategy: "default",
              command: "printf 'ok\\n'",
              output: "ok",
              explanation: "Print ok.",
              attempts: [],
              finalCheck: {
                passed: true,
                iterations: 1,
                engine: "replay",
                reason: "ok",
                score: {
                  value: 100,
                  breakdown: {
                    correctness: 60,
                    stdoutQuality: 15,
                    stderrQuality: 10,
                    expectedOutput: 15
                  }
                }
              }
            }
          ],
          finalCheck: {
            passed: true,
            iterations: 1,
            engine: "replay",
            reason: "ok",
            score: {
              value: 100,
              breakdown: {
                correctness: 60,
                stdoutQuality: 15,
                stderrQuality: 10,
                expectedOutput: 15
              }
            }
          },
          selectedCandidateId: "worker-1",
          startedAt: "2026-06-12T12:00:00.000Z",
          finishedAt: "2026-06-12T12:00:01.000Z",
          workdir: projectDir,
          runner: {
            name: "local",
            limits: {},
            sandboxPolicy: {}
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const restored = await showSavedLog(logPath);

    expect(restored.selector.reason).toContain("selected in the source log");
    expect(restored.command).toBe("printf 'ok\\n'");
    expect(restored.output).toBe("ok");
  });
});
