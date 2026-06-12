import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  writeCheckSessionLog,
  writeReplaySessionLog,
  writeSolveSessionLog
} from "../src/logs/writer.js";

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
      runner: { name: "local" },
      runnerLimits: {},
      sandboxPolicy: {},
      problemText: "print ok",
      expectedOutput: "ok"
    };
    const result = {
      command: "printf 'ok\\n'",
      attempts: [],
      candidates: [{ candidateId: "check-1" }],
      finalCheck: { passed: true },
      stopReason: "Completed explicit command check."
    };

    const first = await writeCheckSessionLog({ logsDir, session, result });
    const second = await writeCheckSessionLog({ logsDir, session, result });
    const logContent = JSON.parse(await readFile(first.logPath, "utf8"));

    expect(path.basename(first.logPath)).toBe("check-2026-06-12T00-00-00-000Z.json");
    expect(path.basename(second.logPath)).toBe("check-2026-06-12T00-00-00-000Z-2.json");
    expect(logContent.mode).toBe("check");
    expect(logContent.problemSpec.expectedOutput).toBe("ok");
  });
});

describe("writeSolveSessionLog", () => {
  it("stores shellgei score mode, notes, penalties, selector metrics, and assigned variants", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const session = {
      sessionId: "session-2",
      startedAt: "2026-06-13T00:00:00.000Z",
      workdir: "/tmp/workdir",
      runner: { name: "local" },
      runnerLimits: {},
      sandboxPolicy: {},
      shellgeiScoreMode: "standard",
      problem: { raw: "print 42", problemText: "print 42" },
      plan: {
        mode: "single",
        parallelism: 1,
        variants: [
          {
            variantId: "variant-awk",
            label: "awk-first",
            approach: "awk-record-pass",
            toolBias: ["awk"],
            intent: "Start with a compact single-pass transform.",
            constraints: ["Prefer concise one-liners"],
            avoid: ["temporary files"],
            explorationHint: "Try awk first."
          }
        ],
        workerTasks: [
          {
            workerId: "worker-1",
            strategy: "default",
            strategyProfile: {
              name: "balanced-search",
              focus: "Start with direct safe one-liner.",
              retryHint: "Remove redundant stages before changing whole approach.",
              rubricFocus: ["conciseness", "shellness", "robustness"]
            },
            assignedVariant: {
              variantId: "variant-awk",
              label: "awk-first",
              approach: "awk-record-pass",
              toolBias: ["awk"],
              intent: "Start with a compact single-pass transform.",
              constraints: ["Prefer concise one-liners"],
              avoid: ["temporary files"],
              explorationHint: "Try awk first."
            },
            maxAttempts: 1
          }
        ],
        planner: {
          provider: "rule-based",
          fallbackReason: null
        }
      }
    };
    const candidates = [
      {
        candidateId: "worker-1",
        command: "printf '42\\n'",
        finalCheck: { passed: true, score: { value: 100, breakdown: {} } },
        shellgeiScore: {
          value: 72,
          mode: "standard",
          breakdown: {
            conciseness: 13,
            shellness: 14,
            ingenuity: 12,
            readability: 11,
            robustness: 12,
            artistry: 10
          },
          notes: ["Uses a single awk pass"],
          penalties: ["Avoid useless use of cat"]
        }
      }
    ];

    const { logPath } = await writeSolveSessionLog({
      logsDir,
      session,
      summary: {
        finishedAt: "2026-06-13T00:00:05.000Z",
        selectedCandidateId: "worker-1",
        stopReason: null,
        selectorReason: "won on shellgei score",
        selectorScore: { value: 100, breakdown: {} },
        selectorMetrics: {
          totalScore: 187,
          shellgeiScore: 72,
          rubricBreakdown: candidates[0].shellgeiScore.breakdown
        }
      },
      attempts: [],
      candidates,
      workerSummaries: [],
      finalCheck: candidates[0].finalCheck
    });

    const logContent = JSON.parse(await readFile(logPath, "utf8"));

    expect(logContent.shellgeiScoreMode).toBe("standard");
    expect(logContent.candidates[0].shellgeiScore).toEqual(
      expect.objectContaining({
        mode: "standard",
        notes: expect.any(Array),
        penalties: expect.any(Array)
      })
    );
    expect(logContent.selector.metrics).toEqual(
      expect.objectContaining({
        totalScore: 187,
        shellgeiScore: 72,
        rubricBreakdown: expect.objectContaining({
          conciseness: 13
        })
      })
    );
    expect(logContent.plan.workerTasks[0].assignedVariant).toEqual(
      expect.objectContaining({
        variantId: "variant-awk",
        approach: "awk-record-pass"
      })
    );
  });
});

describe("writeReplaySessionLog", () => {
  it("writes replay logs with source and target metadata", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const session = {
      sessionId: "session-3",
      startedAt: "2026-06-13T01:00:00.000Z",
      sourceLogPath: "/tmp/source-solve.json",
      sourceSelectedCandidateId: "worker-2",
      workdir: "/tmp/workdir",
      runner: { name: "local" },
      runnerLimits: {},
      sandboxPolicy: {},
      problem: {
        raw: "print ok",
        problemText: "print ok",
        expectedOutput: "ok",
        metadata: { format: "plain-text" }
      },
      replayTarget: "selected"
    };
    const result = {
      attempts: [{ attemptId: "replay-1", command: "printf 'ok\\n'" }],
      candidates: [{ candidateId: "worker-2", command: "printf 'ok\\n'" }],
      finalCheck: { passed: true, reason: "ok" },
      stopReason: null
    };

    const { logPath } = await writeReplaySessionLog({ logsDir, session, result });
    const logContent = JSON.parse(await readFile(logPath, "utf8"));

    expect(logContent.mode).toBe("replay");
    expect(logContent.sourceLogPath).toBe("/tmp/source-solve.json");
    expect(logContent.sourceSelectedCandidateId).toBe("worker-2");
    expect(logContent.replayTarget).toBe("selected");
    expect(logContent.candidates[0].candidateId).toBe("worker-2");
  });
});
