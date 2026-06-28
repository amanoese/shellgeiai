import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { listSavedLogs, pruneSavedLogs, searchSavedLogs } from "../src/io/logs/catalog.js";
import { writeJson } from "../src/shared/fs.js";

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

    expect(logs.map((log) => log.filename)).toEqual([
      "check-2026-06-12T00-00-00-000Z.json",
      "solve-2026-06-10T00-00-00-000Z.json"
    ]);
    expect(logs[0]).toMatchObject({
      mode: "check",
      problem: "print ok",
      command: "printf 'ok\\n'",
      selectedCandidateId: "check-1",
      passed: true
    });
  });

  it("searches logs by query, mode, and pass status", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-catalog-"));
    tempDirs.push(logsDir);
    await createLog(logsDir, "solve-2026-06-10T00-00-00-000Z.json", {
      problem: "count lines",
      startedAt: "2026-06-10T00:00:00.000Z",
      finishedAt: "2026-06-10T00:00:02.000Z",
      candidates: [{ command: "wc -l" }],
      finalCheck: { passed: false }
    });
    await createLog(logsDir, "solve-2026-06-11T00-00-00-000Z.json", {
      problem: "print ok",
      startedAt: "2026-06-11T00:00:00.000Z",
      finishedAt: "2026-06-11T00:00:02.000Z",
      candidates: [{ command: "printf 'ok\\n'" }],
      selectedCandidateId: "worker-1",
      finalCheck: { passed: true }
    });

    const queryMatches = await searchSavedLogs({ logsDir, query: "print" });
    const passedSolveMatches = await searchSavedLogs({ logsDir, mode: "solve", passed: true });

    expect(queryMatches.map((log) => log.filename)).toEqual([
      "solve-2026-06-11T00-00-00-000Z.json"
    ]);
    expect(passedSolveMatches).toHaveLength(1);
    expect(passedSolveMatches[0].filename).toBe("solve-2026-06-11T00-00-00-000Z.json");
  });

  it("prunes logs older than retention window and supports dry runs", async () => {
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

    expect(dryRun.deleted.map((log) => log.filename)).toEqual([
      "solve-2026-05-01T00-00-00-000Z.json"
    ]);
    expect(await readdir(logsDir)).toHaveLength(2);

    const result = await pruneSavedLogs({
      logsDir,
      retainDays: 7,
      now: new Date("2026-06-12T00:00:00.000Z"),
      dryRun: false
    });

    expect(result.deletedCount).toBe(1);
    expect(await readdir(logsDir)).toEqual(["solve-2026-06-11T00-00-00-000Z.json"]);
  });
});
