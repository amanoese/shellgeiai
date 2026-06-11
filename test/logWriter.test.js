import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCheckSessionLog } from "../src/logs/writer.js";

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
