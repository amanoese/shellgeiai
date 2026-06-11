import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCheckSessionLog } from "../src/logs/writer.js";
import { solveProblem } from "../src/core/solve.js";
import { SimpleJudge } from "../src/judge/simpleJudge.js";
import { LocalRunner } from "../src/runner/localRunner.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("writeCheckSessionLog", () => {
  it("uses a unique filename when the timestamp would otherwise collide", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const startedAt = "2026-06-12T00:00:00.000Z";
    const session = {
      sessionId: "session-1",
      startedAt,
      workdir: "/tmp/workdir",
      runner: {
        name: "local"
      },
      runnerLimits: {},
      sandboxPolicy: {},
      problemText: "print ok",
      expectedOutput: "ok"
    };
    const result = {
      command: "printf 'ok\\n'",
      attempts: [],
      candidates: [
        {
          candidateId: "check-1"
        }
      ],
      finalCheck: {
        passed: true
      },
      stopReason: "Completed explicit command check."
    };

    const first = await writeCheckSessionLog({ logsDir, session, result });
    const second = await writeCheckSessionLog({ logsDir, session, result });

    expect(path.basename(first.logPath)).toBe("check-2026-06-12T00-00-00-000Z.json");
    expect(path.basename(second.logPath)).toBe("check-2026-06-12T00-00-00-000Z-2.json");
    expect(first.logId).toBe("2026-06-12T00-00-00-000Z");
    expect(second.logId).toBe("2026-06-12T00-00-00-000Z-2");
  });
});

describe("writeSolveSessionLog", () => {
  it("persists selector details for best-score selection", async () => {
    const requestedWorkdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(requestedWorkdir);

    const result = await solveProblem({
      problemInput: "print ok",
      engine: {
        name: "test-engine",
        async generateCommand(context) {
          if (context.workerId === "worker-1") {
            return {
              command: "printf 'ok\\n'",
              explanation: "First candidate."
            };
          }

          return {
            command: "sleep 0.01; printf 'ok\\n'",
            explanation: "Second candidate."
          };
        }
      },
      runner: new LocalRunner(),
      judge: new SimpleJudge(),
      maxIterations: 1,
      requestedWorkdir,
      parallelism: 2,
      selector: "best-score-wins"
    });

    const logContent = JSON.parse(await readFile(result.logPath, "utf8"));

    expect(logContent.selector).toEqual({
      name: "best-score-wins",
      reason: result.selector.reason,
      selectedCandidateId: result.selector.selectedCandidateId,
      score: result.selector.score,
      metrics: result.selector.metrics
    });
    expect(logContent.selectedCandidateId).toBe(result.selector.selectedCandidateId);
  });
});
