import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { listSavedLogs, pruneSavedLogs, searchSavedLogs } from "../src/logs/catalog.js";
import { writeJson } from "../src/util/fs.js";

const tempDirs = [];

async function createLog(logsDir, filename, payload) {
  const logPath = path.join(logsDir, filename);
  await writeJson(logPath, payload);
  return logPath;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("logCatalog", () => {
  it("lists saved logs newest-first with searchable summary fields", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-catalog-"));
    tempDirs.push(logsDir);

    await createLog(logsDir, "solve-2026-06-10T00-00-00-000Z.json", {
      problem: "count lines",
      startedAt: "2026-06-10T00:00:00.000Z",
      finishedAt: "2026-06-10T00:00:02.000Z",
      candidates: [{ command: "wc -l" }],
      finalCheck: { passed: false }
    });
    await createLog(logsDir, "check-2026-06-12T00-00-00-000Z.json", {
      mode: "check",
      problem: "print ok",
      command: "printf 'ok\\n'",
      selectedCandidateId: "check-1",
      startedAt: "2026-06-12T00:00:00.000Z",
      finishedAt: "2026-06-12T00:00:01.000Z",
      finalCheck: { passed: true }
    });

    const logs = await listSavedLogs({ logsDir });

    expect(logs).toHaveLength(2);
    expect(logs.map((log) => log.filename)).toEqual([
      "check-2026-06-12T00-00-00-000Z.json",
      "solve-2026-06-10T00-00-00-000Z.json"
    ]);
    expect(logs[0]).toMatchObject({
      logId: "check-2026-06-12T00-00-00-000Z",
      mode: "check",
      problem: "print ok",
      command: "printf 'ok\\n'",
      selectedCandidateId: "check-1",
      passed: true
    });
  });

  it("searches logs by partial text and optional mode/passed filters", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-catalog-"));
    tempDirs.push(logsDir);

    await createLog(logsDir, "solve-2026-06-11T00-00-00-000Z.json", {
      problem: "extract only ok rows",
      candidates: [{ command: "grep ok data.txt" }],
      startedAt: "2026-06-11T00:00:00.000Z",
      finishedAt: "2026-06-11T00:00:01.000Z",
      finalCheck: { passed: true }
    });
    await createLog(logsDir, "replay-2026-06-12T00-00-00-000Z.json", {
      mode: "replay",
      problem: "replay grep result",
      replayTarget: { command: "grep ng data.txt" },
      startedAt: "2026-06-12T00:00:00.000Z",
      finishedAt: "2026-06-12T00:00:01.000Z",
      finalCheck: { passed: false }
    });
    await createLog(logsDir, "replay-2026-06-12T01-00-00-000Z.json", {
      mode: "replay",
      problem: "replay by attempt id",
      sourceLogPath: "/tmp/source-solve.json",
      sourceSelectedCandidateId: "worker-2",
      replayTarget: {
        kind: "attempt",
        id: "attempt-1",
        sourceCandidateId: "worker-2",
        sourceAttemptId: "attempt-1",
        sourceWorkerId: "worker-2",
        sourceStrategy: "default",
        selectionReason: "Selected attempt 'attempt-1' because --attempt-id was specified."
      },
      startedAt: "2026-06-12T01:00:00.000Z",
      finishedAt: "2026-06-12T01:00:01.000Z",
      finalCheck: { passed: true }
    });

    const grepMatches = await searchSavedLogs({ logsDir, query: "grep" });
    const passedSolveMatches = await searchSavedLogs({ logsDir, query: "ok", mode: "solve", passed: true });
    const attemptMatches = await searchSavedLogs({ logsDir, query: "attempt-1" });

    expect(grepMatches.map((log) => log.filename)).toEqual([
      "replay-2026-06-12T00-00-00-000Z.json",
      "solve-2026-06-11T00-00-00-000Z.json"
    ]);
    expect(passedSolveMatches).toHaveLength(1);
    expect(passedSolveMatches[0].filename).toBe("solve-2026-06-11T00-00-00-000Z.json");
    expect(attemptMatches.map((log) => log.filename)).toContain("replay-2026-06-12T01-00-00-000Z.json");
    expect(attemptMatches[0]).toMatchObject({
      sourceLogPath: "/tmp/source-solve.json",
      sourceSelectedCandidateId: "worker-2",
      replayTargetKind: "attempt",
      replayTargetAttemptId: "attempt-1"
    });
  });

  it("prunes logs older than the retention window and supports dry runs", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-catalog-"));
    tempDirs.push(logsDir);

    await createLog(logsDir, "solve-2026-05-01T00-00-00-000Z.json", {
      problem: "old run",
      startedAt: "2026-05-01T00:00:00.000Z",
      finishedAt: "2026-05-01T00:10:00.000Z",
      finalCheck: { passed: true }
    });
    await createLog(logsDir, "solve-2026-06-11T00-00-00-000Z.json", {
      problem: "recent run",
      startedAt: "2026-06-11T00:00:00.000Z",
      finishedAt: "2026-06-11T00:05:00.000Z",
      finalCheck: { passed: true }
    });

    const dryRun = await pruneSavedLogs({
      logsDir,
      retainDays: 7,
      now: new Date("2026-06-12T00:00:00.000Z"),
      dryRun: true
    });

    expect(dryRun.deleted.map((log) => log.filename)).toEqual(["solve-2026-05-01T00-00-00-000Z.json"]);
    expect((await readdir(logsDir)).sort()).toEqual([
      "solve-2026-05-01T00-00-00-000Z.json",
      "solve-2026-06-11T00-00-00-000Z.json"
    ]);

    const pruned = await pruneSavedLogs({
      logsDir,
      retainDays: 7,
      now: new Date("2026-06-12T00:00:00.000Z")
    });

    expect(pruned.deletedCount).toBe(1);
    expect(pruned.keptCount).toBe(1);
    expect(await readdir(logsDir)).toEqual(["solve-2026-06-11T00-00-00-000Z.json"]);
  });
});
