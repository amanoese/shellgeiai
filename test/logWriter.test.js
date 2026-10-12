import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeSolveSessionLog } from "../dist/io/logs.js";
import { createSearchKnowledgeTool } from "../dist/knowledge/runtime.js";
import { generateWorkerCommand } from "../dist/solve/tools.js";
import { createToolRegistry } from "../dist/solve/tools.js";
import { OpenAIEngine } from "../dist/providers/apiEngine.js";
import { solveProblem } from "../dist/solve/solve.js";
import { createTestPlannerProvider } from "./support/testPlannerProvider.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function buildSolveSession() {
  return {
    sessionId: "session-1",
    problem: {
      raw: "print ok",
      problemText: "print ok",
      expectedOutput: "ok",
      metadata: { format: "plain-text" }
    },
    engine: { name: "test-engine" },
    runner: { name: "local" },
    runnerLimits: {},
    sandboxPolicy: {},
    writableWorkdir: false,
    dockerDevicesReadonly: ["/dev/null"],
    workdir: "/tmp/workdir",
    mode: "parallel",
    parallelism: 1,
    selectorName: "best-score-wins",
    shellgeiScoreMode: "simple",
    plan: {
      mode: "parallel",
      parallelism: 1,
      workerTasks: [
        {
          workerId: "worker-1",
          strategy: "default",
          maxAttempts: 1
        }
      ],
      planner: { provider: "rule-based", fallbackReason: null }
    }
  };
}

describe("writeSolveSessionLog", () => {
  it("logs only the public LLM allowlist without serializing providers or session secrets", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const session = buildSolveSession();
    const snapshot = { provider: "openrouter", baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-6.1-sol", plannerModel: "planner-model", timeoutMs: 30000, maxRetries: 2 };
    const secret = "PRIVATE LLM SENTINEL";
    session.llmConfig = { ...snapshot, apiKey: secret, Authorization: secret,
      headers: { authorization: secret }, request: secret, error: { body: secret }, unexpected: secret };
    session.engine.apiKey = secret;
    session.plannerProvider = { privateClient: secret };
    session.continuation = secret;
    const { logPath } = await writeSolveSessionLog({ logsDir, session,
      summary: { finishedAt: "2026-06-13T00:00:05.000Z" }, attempts: [], candidates: [], finalCheck: { passed: false } });
    const content = await readFile(logPath, "utf8");
    expect(JSON.parse(content).llm).toEqual(snapshot);
    expect(content).not.toContain(secret);
  });

  it("omits LLM metadata for fully injected runtimes without config", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const { logPath } = await writeSolveSessionLog({ logsDir, session: buildSolveSession(),
      summary: { finishedAt: "2026-06-13T00:00:05.000Z" }, attempts: [], candidates: [], finalCheck: { passed: false } });
    expect(JSON.parse(await readFile(logPath, "utf8"))).not.toHaveProperty("llm");
  });

  it("keeps actual solve logs free of Responses reasoning, replay history and Tool bodies", async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-pipeline-"));
    tempDirs.push(workdir);
    const encrypted = "PRIVATE ENCRYPTED REASONING";
    const reasoning = "PRIVATE REASONING SUMMARY";
    const recordText = "PRIVATE TOOL RECORD BODY";
    const apiKey = "PRIVATE API KEY";
    let requests = 0;
    const engine = new OpenAIEngine({
      apiKey, baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-6.1-sol",
      plannerModel: "openai/gpt-6.1-sol", timeoutMs: 30000, maxRetries: 0, client: {
      responses: { async create(request) {
        if (request.input.some((item) => item.role === "user" && item.content?.some((content) => content.text?.includes("Worker: worker-2")))) {
          return { status: "completed", output_text: JSON.stringify({ command: "printf 'ok\\n'", explanation: "Print ok." }) };
        }
        requests += 1;
        if (requests === 1) return { id: "private-response-id", status: "completed", output: [
          { type: "reasoning", id: "private-reasoning-id", encrypted_content: encrypted,
            summary: [{ type: "summary_text", text: reasoning }] },
          { type: "function_call", id: "private-tool-id", call_id: "private-call-id",
            name: "search_knowledge", arguments: JSON.stringify({ query: "print ok" }) }
        ] };
        expect(JSON.stringify(request.input)).toContain(encrypted);
        expect(JSON.stringify(request.input)).toContain(recordText);
        return { status: "completed", output_text: JSON.stringify({ command: "printf 'ok\\n'", explanation: "Print ok." }) };
      } }
    } });
    const result = await solveProblem({
      problemInput: "print ok", engine, maxIterations: 1, requestedWorkdir: workdir, parallelism: 2,
      runner: { name: "mock", run: async () => ({ stdout: "ok\n", stderr: "", exitCode: 0, durationMs: 1 }) },
      judge: { judge: async () => ({ passed: true, reason: "ok", score: { value: 100, breakdown: {} } }) },
      plannerProvider: createTestPlannerProvider(), knowledgeMode: "worker",
      knowledgeRetriever: { search: async () => [{ id: "record-1", command: "printf", text: recordText, source: "test" }] }
    });
    const content = await readFile(result.logPath, "utf8");
    expect(result.finalCheck.passed).toBe(true);
    expect(requests).toBe(2);
    expect(JSON.parse(content).llm).toEqual({ provider: "openrouter", baseURL: "https://openrouter.ai/api/v1",
      model: "openai/gpt-6.1-sol", plannerModel: "openai/gpt-6.1-sol", timeoutMs: 30000, maxRetries: 0 });
    expect(JSON.parse(content).attempts[0].toolCalls).toEqual([{
      name: "search_knowledge", arguments: { query: "print ok" }, status: "completed", resultCount: 1, recordIds: ["record-1"]
    }]);
    for (const privateValue of [apiKey, encrypted, reasoning, recordText, "private-response-id", "private-reasoning-id", "private-tool-id", "private-call-id"]) {
      expect(content).not.toContain(privateValue);
    }
    expect(content).not.toContain('"continuation"');
    expect(content).not.toContain('"toolResults"');
  });

  it("logs a reproducible knowledge snapshot and excludes injected credential fields", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const session = buildSolveSession();
    const snapshot = { provider: "openrouter", model: "test-model", inputProfile: "qwen-retrieval-v1", dbPath: "/tmp/test.sqlite",
      dimensions: 2, generationId: 7, datasetFingerprint: "abc" };
    session.knowledgeMode = "planner";
    session.knowledgeSnapshot = { ...snapshot, apiKey: "DO NOT LOG THIS", authorization: "SECRET" };
    const { logPath } = await writeSolveSessionLog({ logsDir, session, summary: { finishedAt: "2026-06-13T00:00:05.000Z" },
      attempts: [], candidates: [], finalCheck: { passed: false } });
    const content = await readFile(logPath, "utf8");
    expect(JSON.parse(content).knowledge).toEqual({ mode: "planner", ...snapshot });
    expect(content).not.toContain("DO NOT LOG THIS");
    expect(content).not.toContain("SECRET");
  });
  it("uses a unique filename when timestamp would otherwise collide", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const session = buildSolveSession();
    const summary = {
      finishedAt: "2026-06-13T00:00:05.000Z",
      selectedCandidateId: null,
      stopReason: "No candidate was produced.",
      selectorReason: "No candidate was selected.",
      selectorScore: null,
      selectorMetrics: null
    };

    const first = await writeSolveSessionLog({
      logsDir,
      session,
      summary,
      attempts: [],
      candidates: [],
      workerSummaries: [],
      finalCheck: { passed: false, reason: "No candidate was produced." }
    });
    const second = await writeSolveSessionLog({
      logsDir,
      session,
      summary,
      attempts: [],
      candidates: [],
      workerSummaries: [],
      finalCheck: { passed: false, reason: "No candidate was produced." }
    });

    const logContent = JSON.parse(await readFile(first.logPath, "utf8"));
    expect(path.basename(first.logPath)).toBe("solve-2026-06-13T00-00-05-000Z.json");
    expect(path.basename(second.logPath)).toBe("solve-2026-06-13T00-00-05-000Z-2.json");
    expect(logContent.mode).toBe("solve");
    expect(logContent.problemSpec.expectedOutput).toBe("ok");
    expect(logContent.runner.dockerDevicesReadonly).toEqual(["/dev/null"]);
  });

  it("writes solve plan and shellgei score metadata", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const session = buildSolveSession();
    const candidates = [
      {
        candidateId: "worker-1",
        command: "printf '42\\n'",
        finalCheck: { passed: true, score: { value: 100, breakdown: {} } },
        shellgeiScore: {
          value: 72,
          mode: "simple",
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
    expect(logContent.shellgeiScoreMode).toBe("simple");
    expect(logContent.candidates[0].shellgeiScore).toEqual(
      expect.objectContaining({
          mode: "simple",
        notes: expect.any(Array),
        penalties: expect.any(Array)
      })
    );
    expect(logContent.selector.metrics).toEqual(
      expect.objectContaining({
        totalScore: 187,
        shellgeiScore: 72,
        rubricBreakdown: expect.objectContaining({ conciseness: 13 })
      })
    );
    expect(logContent.plan.workerTasks[0]).toEqual(
      expect.objectContaining({ workerId: "worker-1", strategy: "default" })
    );
  });

  it("retains normalized knowledge metadata and bounded Worker Tool summaries without Tool records", async () => {
    const logsDir = await mkdtemp(path.join(os.tmpdir(), "shellgeiai-log-writer-"));
    tempDirs.push(logsDir);
    const session = buildSolveSession();
    const workerRetrievedRecordText = "SECRET WORKER TOOL RECORD TEXT";
    const plannerReferenceText = "BOUNDED PLANNER REFERENCE TEXT";
    session.knowledgeMode = "all";
    session.plan = {
      ...session.plan,
      knowledgeMode: "all",
      planner: {
        provider: "llm",
        attemptedProvider: "llm",
        fallbackReason: null,
        promptVersion: "2026-08-02-llm-planner-v2",
        prompt: `Planner used bounded, untrusted knowledge references: ${plannerReferenceText}`
      },
      workerTasks: [
        {
          workerId: "worker-1",
          strategy: "default",
          maxAttempts: 1,
          assignedVariant: {
            toolSuggestions: [
              {
                summary: "Try an awk field-oriented approach.",
                rationale: "The planner selected a relevant command family.",
                suggestedTools: ["awk"]
              }
            ]
          }
        }
      ]
    };
    const toolRegistry = createToolRegistry();
    toolRegistry.register(
      createSearchKnowledgeTool({
        retriever: {
          async search() {
            return [
              {
                id: "man:awk:-F",
                command: "awk",
                option: "-F",
                text: workerRetrievedRecordText,
                source: "man"
              }
            ];
          }
        }
      })
    );
    let turn = 0;
    const { toolCalls } = await generateWorkerCommand({
      engine: {
        async generateTurn() {
          turn += 1;
          return turn === 1
            ? {
                type: "tool_calls",
                calls: [
                  {
                    id: "provider-call-1",
                    name: "search_knowledge",
                    arguments: { query: "CSV third field" }
                  }
                ],
                continuation: { responseId: "provider-response-1" }
              }
            : { type: "command", command: "awk '{print $3}'" };
        }
      },
      context: { problem: "CSV third field", attempts: [], workdir: "/tmp/workdir" },
      toolRegistry
    });

    const { logPath } = await writeSolveSessionLog({
      logsDir,
      session,
      summary: {
        finishedAt: "2026-06-13T00:00:05.000Z",
        selectedCandidateId: "worker-1",
        stopReason: null,
        selectorReason: "selected",
        selectorScore: { value: 100, breakdown: {} },
        selectorMetrics: null
      },
      attempts: [
        {
          attemptId: "worker-1-attempt-1",
          workerId: "worker-1",
          command: "awk '{print $3}'",
          passed: true,
          toolCalls
        }
      ],
      candidates: [],
      workerSummaries: [
        {
          workerId: "worker-1",
          attemptCount: 1,
          passed: true,
          state: "completed",
          reason: "ok"
        }
      ],
      finalCheck: { passed: true, reason: "ok" }
    });

    const serializedLog = await readFile(logPath, "utf8");
    const logContent = JSON.parse(serializedLog);
    expect(logContent.plan.knowledgeMode).toBe("all");
    expect(logContent.planner).toEqual(
      expect.objectContaining({
        provider: "llm",
        attemptedProvider: "llm",
        promptVersion: "2026-08-02-llm-planner-v2"
      })
    );
    expect(logContent.plan.workerTasks[0].assignedVariant.toolSuggestions).toEqual([
      expect.objectContaining({ suggestedTools: ["awk"] })
    ]);
    expect(logContent.planner.prompt).toContain(plannerReferenceText);
    expect(logContent.workerSummaries).toEqual([
      expect.objectContaining({ workerId: "worker-1", attemptCount: 1 })
    ]);
    expect(logContent.attempts[0].toolCalls).toEqual([
      {
        name: "search_knowledge",
        arguments: { query: "CSV third field" },
        status: "completed",
        resultCount: 1,
        recordIds: ["man:awk:-F"]
      }
    ]);
    const serializedWorkerLog = JSON.stringify({
      attempts: logContent.attempts,
      workerSummaries: logContent.workerSummaries
    });
    expect(serializedWorkerLog).not.toContain(workerRetrievedRecordText);
    expect(serializedWorkerLog).not.toContain("provider-call-1");
    expect(serializedWorkerLog).not.toContain("provider-response-1");
    expect(serializedWorkerLog).not.toContain('"text"');
    expect(serializedWorkerLog).not.toContain('"value"');
    expect(serializedWorkerLog).not.toContain('"result"');
    expect(serializedWorkerLog).not.toContain('"continuation"');
    expect(serializedWorkerLog).not.toContain('"toolResults"');
  });
});
