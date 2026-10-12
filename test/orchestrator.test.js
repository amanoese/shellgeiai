import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAbortedAttempt,
  createGenerationFailedAttempt,
  createWorkerCandidate,
  createWorkerSummary
} from "../dist/solve/worker.js";
import { getRemainingBudgetMs, getWorkerStopReason } from "../dist/solve/worker.js";
import { calculateWorkerConcurrency, createWorkerTaskQueue } from "../dist/solve/orchestrator.js";
import { executeWorkerTask, runWorkerAttempt } from "../dist/solve/worker.js";
import { createExecutionSummary } from "../dist/solve/orchestrator.js";
import { createExecutionControl } from "../dist/solve/orchestrator.js";
import { runSolveOrchestrator } from "../dist/solve/orchestrator.js";
import { createKnowledgeRetriever } from "../dist/knowledge/runtime.js";
import { createSearchKnowledgeTool } from "../dist/knowledge/runtime.js";
import { createToolRegistry } from "../dist/solve/tools.js";

afterEach(() => vi.useRealTimers());

function waitForAbort(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    if (signal.aborted) reject(signal.reason);
  });
}

describe("orchestrator generation cancellation", () => {
  it("returns the passing candidate after grace-stop while knowledge embedding is still pending", async () => {
    vi.useFakeTimers();
    const sessionController = new AbortController();
    const embedding = Promise.withResolvers();
    const embedder = { embed: vi.fn(() => embedding.promise) };
    const retriever = createKnowledgeRetriever({
      store: { search: () => [] }, generationId: 7, embedder, signal: sessionController.signal
    });
    const toolRegistry = createToolRegistry();
    toolRegistry.register(createSearchKnowledgeTool({ retriever }));
    let passed = false;
    const engine = {
      name: "fake",
      generateTurn: vi.fn(async ({ context }) => context.workerId === "worker-1"
        ? { type: "command", command: "printf ok" }
        : { type: "tool_calls", calls: [{ id: "c1", name: "search_knowledge", arguments: { query: "awk" } }], continuation: {} })
    };
    const session = { generation: "tools", knowledgeMode: "worker",
      problem: { problemText: "print ok" }, workdir: "/tmp", selectorName: "first-pass-wins",
      signal: sessionController.signal, engine, toolRegistry,
      runner: { run: vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0, durationMs: 1 })) },
      judge: { judge: async () => ({ passed: true, reason: "ok" }) },
      onProgress: event => { if (event.type === "attempt-finished" && event.passed) passed = true; },
      plan: { parallelism: 2, workerTasks: ["worker-1", "worker-2"].map(workerId => ({ workerId, strategy: "default", maxAttempts: 1 })) }
    };
    let outcome;
    const run = runSolveOrchestrator(session)
      .then(value => { outcome = { value }; }, error => { outcome = { error }; });

    try {
      await vi.waitFor(() => { expect(embedder.embed).toHaveBeenCalledOnce(); expect(passed).toBe(true); });
      await vi.advanceTimersByTimeAsync(5000);
      expect(outcome, "orchestrator must finish before the embedding resolves").toBeDefined();
      expect(outcome.error).toBeUndefined();
      expect(outcome.value.passingCandidateId).toBe("worker-1");
      expect(outcome.value.candidates[0].finalCheck.passed).toBe(true);
      expect(outcome.value.workerSummaries[1]).toMatchObject({ state: "stopped", reason: "Stopped after first passing candidate was produced." });
      expect(sessionController.signal.aborted).toBe(false);
      expect(engine.generateTurn).toHaveBeenCalledTimes(2);
      expect(session.runner.run).toHaveBeenCalledOnce();
    } finally {
      embedding.resolve([1, 0]);
      await run;
    }
  });

  it.each(["command", "first-tool-turn", "resume-tool-turn"])("preserves the passing candidate when grace-stop cancels %s", async path => {
    vi.useFakeTimers();
    let waiting = false;
    let passed = false;
    const generate = async (context, signal, continuation) => {
      if (context.workerId === "worker-1") return { type: "command", command: "printf ok" };
      if (path === "resume-tool-turn" && !continuation) return { type: "tool_calls",
        calls: [{ id: "c1", name: "search_knowledge", arguments: { query: "awk" } }], continuation: {} };
      waiting = true;
      return waitForAbort(signal);
    };
    const session = { generation: "command", knowledgeMode: "off",
      problem: { problemText: "print ok" }, workdir: "/tmp", selectorName: "first-pass-wins",
      engine: { name: "fake", generateCommand: (context, { signal }) => generate(context, signal),
        generateTurn: ({ context, signal, continuation }) => generate(context, signal, continuation) },
      ...(path === "command" ? {} : { generation: "tools", knowledgeMode: "worker", toolRegistry: { definitions: () => [], execute: async () => ({ ok: true, value: { records: [] }, validatedArguments: { query: "awk" } }) } }),
      runner: { run: vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0, durationMs: 1 })) },
      judge: { judge: async () => ({ passed: true, reason: "ok" }) },
      onProgress: event => { if (event.type === "attempt-finished" && event.passed) passed = true; },
      plan: { parallelism: 2, workerTasks: ["worker-1", "worker-2"].map(workerId => ({ workerId, strategy: "default", maxAttempts: 1 })) }
    };
    const outcome = runSolveOrchestrator(session).then(value => ({ value }), error => ({ error }));
    await vi.waitFor(() => { expect(waiting).toBe(true); expect(passed).toBe(true); });
    await vi.advanceTimersByTimeAsync(5000);
    const { value, error } = await outcome;
    expect(error).toBeUndefined();
    expect(value.passingCandidateId).toBe("worker-1");
    expect(value.candidates[0].finalCheck.passed).toBe(true);
    expect(value.workerSummaries[1]).toMatchObject({ state: "stopped", reason: "Stopped after first passing candidate was produced." });
    expect(session.runner.run).toHaveBeenCalledOnce();
  });

  it("returns stopped summaries on the overall deadline during generation", async () => {
    vi.useFakeTimers();
    const sessionController = new AbortController();
    const session = { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp", deadlineAtMs: Date.now() + 50,
      signal: sessionController.signal, engine: { name: "fake", generateCommand: (_context, { signal }) => waitForAbort(signal) },
      plan: { parallelism: 2, workerTasks: ["worker-1", "worker-2"].map(workerId => ({ workerId, strategy: "default", maxAttempts: 1 })) }
    };
    setTimeout(() => sessionController.abort(new Error("Solve time budget exceeded.")), 50);
    const outcome = runSolveOrchestrator(session).then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(50);
    const { value, error } = await outcome;
    expect(error).toBeUndefined();
    expect(value.workerSummaries).toHaveLength(2);
    expect(value.workerSummaries.every(worker => worker.state === "stopped" && worker.reason.includes("time budget"))).toBe(true);
  });
});

describe("createExecutionSummary", () => {
  it("orders results by task order and counts failed workers", () => {
    const failedWorkerResult = {
      attempts: [{ attemptId: "failed-attempt" }],
      candidate: {
        workerId: "failed-worker",
        finalCheck: { passed: false }
      },
      workerSummary: { workerId: "failed-worker" }
    };
    const passedWorkerResult = {
      attempts: [{ attemptId: "passed-attempt" }],
      candidate: {
        workerId: "passed-worker",
        finalCheck: { passed: true }
      },
      workerSummary: { workerId: "passed-worker" }
    };

    const summary = createExecutionSummary({
      results: [failedWorkerResult, passedWorkerResult],
      taskOrder: new Map([
        ["passed-worker", 0],
        ["failed-worker", 1]
      ]),
      control: { stopReason: "done", passingCandidateId: "passed-worker" }
    });

    expect(summary.candidates.map((candidate) => candidate.workerId)).toEqual([
      "passed-worker",
      "failed-worker"
    ]);
    expect(summary.failedWorkerCount).toBe(1);
    expect(summary.stopReason).toBe("done");
  });
});

describe("createExecutionControl", () => {
  it("requestStop aborts workers except the passing candidate worker", () => {
    const workers = new Map([
      ["keep", { workerId: "keep", abortController: new AbortController() }],
      ["stop", { workerId: "stop", abortController: new AbortController() }]
    ]);
    const control = createExecutionControl({ selectorName: "first-pass-wins" }, workers);

    control.requestStop({
      reason: "passed",
      passingCandidateId: "keep",
      exceptWorkerId: "keep"
    });

    expect(workers.get("keep").abortController.signal.aborted).toBe(false);
    expect(workers.get("stop").abortController.signal.aborted).toBe(true);
    expect(control.stopReason).toBe("passed");

    control.dispose();
  });
});

describe("executeWorkerTask", () => {
  it("retries with the previous attempt data and preserves the passing candidate", async () => {
    const task = { workerId: "worker-1", strategy: "default", maxAttempts: 2 };
    const generateCommand = vi.fn(async context => ({ command: context.attempts.length ? "printf ok" : "printf wrong", explanation: context.attempts.length ? "Corrected" : "First try" }));
    const control = { passingCandidateId: null };
    const result = await executeWorkerTask({ generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp", selectorName: "best-score-wins",
      engine: { name: "test", generateCommand },
      runner: { run: async command => ({ stdout: command === "printf ok" ? "ok" : "wrong", stderr: "", exitCode: 0, timedOut: false }) },
      judge: { judge: async ({ stdout }) => ({ passed: stdout === "ok", reason: stdout === "ok" ? "passed" : "wrong output" }) }
    }, task, control, { abortController: new AbortController() });
    expect(result.attempts.map(attempt => attempt.passed)).toEqual([false, true]);
    expect(generateCommand.mock.calls[1][0].attempts[0]).toMatchObject({ command: "printf wrong", explanation: "First try", failureReason: "wrong output" });
    expect(result.candidate).toMatchObject({ command: "printf ok", output: "ok", explanation: "Corrected", finalCheck: { passed: true, iterations: 2 } });
    expect(result.workerSummary).toMatchObject({ state: "idle", attemptCount: 2, passed: true });
    expect(control.passingCandidateId).toBe(task.workerId);
  });

  it("keeps the generated explanation when deadline stopping produces no attempt", async () => {
    const session = { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp", engine: { name: "test", generateCommand: async () => {
      session.deadlineAtMs = Date.now() - 1;
      return { command: "printf ok", explanation: "Generated before the deadline" };
    } } };
    const result = await executeWorkerTask(session, { workerId: "worker-1", strategy: "default", maxAttempts: 1 }, {}, { abortController: new AbortController() });
    expect(result.attempts).toEqual([]);
    expect(result.candidate.explanation).toBe("Generated before the deadline");
    expect(result.workerSummary).toMatchObject({ state: "stopped", attemptCount: 0, passed: false });
  });
});

describe("getWorkerStopReason", () => {
  it("returns time-budget reason and records it when deadline expired", () => {
    const control = {};
    const reason = getWorkerStopReason({ deadlineAtMs: Date.now() - 1 }, control);

    expect(reason).toBe("Stopped because the overall time budget was exhausted.");
    expect(control.stopReason).toBe("Stopped because the overall time budget was exhausted.");
  });
});

describe("getRemainingBudgetMs", () => {
  it("returns undefined when no deadline is configured", () => {
    expect(getRemainingBudgetMs({})).toBeUndefined();
  });

  it("returns a non-negative remaining budget for an active deadline", () => {
    expect(getRemainingBudgetMs({ deadlineAtMs: Date.now() + 1000 })).toBeGreaterThanOrEqual(0);
  });
});

describe("calculateWorkerConcurrency", () => {
  it("caps concurrency at the number of queued worker tasks", () => {
    expect(calculateWorkerConcurrency(2, 5)).toBe(2);
  });

  it("keeps at least one worker slot when there are no tasks", () => {
    expect(calculateWorkerConcurrency(0, 4)).toBe(1);
  });
});

describe("createWorkerTaskQueue", () => {
  it("returns queued tasks in the original order", () => {
    const queue = createWorkerTaskQueue([
      { workerId: "worker-1" },
      { workerId: "worker-2" }
    ]);

    expect(queue.size()).toBe(2);
    expect(queue.takeNext()).toEqual({ workerId: "worker-1" });
    expect(queue.size()).toBe(1);
    expect(queue.takeNext()).toEqual({ workerId: "worker-2" });
    expect(queue.takeNext()).toBeNull();
    expect(queue.isEmpty()).toBe(true);
  });
});

describe("worker attempt factory", () => {
  const task = {
    workerId: "worker-1",
    strategy: "default",
    strategyProfile: {
      name: "balanced-search",
      focus: "Try a direct shell one-liner."
    }
  };

  it("creates aborted attempt shape with runner metadata", () => {
    const attempt = createAbortedAttempt({
      task,
      iteration: 0,
      command: "printf '42\\n'",
      explanation: "Print the expected value.",
      reason: "Stopped because overall time budget was exhausted.",
      runResult: {
        stdout: "partial\n",
        stderr: "warning\n",
        exitCode: null,
        timedOut: true,
        aborted: true,
        durationMs: 123,
        failure: { message: "aborted" },
        cleanup: { killed: true }
      }
    });

    expect(attempt).toEqual({
      attemptId: "worker-1-attempt-1",
      workerId: "worker-1",
      command: "printf '42\\n'",
      stdout: "partial\n",
      stderr: "warning\n",
      exitCode: null,
      timedOut: true,
      aborted: true,
      passed: false,
      explanation: "Print the expected value.",
      failureReason: "Stopped because overall time budget was exhausted.",
      durationMs: 123,
      runnerFailure: { message: "aborted" },
      runnerCleanup: { killed: true },
      toolCalls: [],
      score: {
        value: 0,
        breakdown: {
          correctness: 0,
          stdoutQuality: 0,
          stderrQuality: 0,
          expectedOutput: 0
        }
      }
    });
  });

  it("creates a retryable generation-failed attempt with bounded Tool audit data", () => {
    const toolCalls = [
      {
        name: "search_knowledge",
        arguments: { query: "awk" },
        status: "completed",
        resultCount: 1,
        recordIds: ["man:awk"]
      }
    ];

    expect(
      createGenerationFailedAttempt({
        task,
        iteration: 0,
        reason: "Worker Tool call limit exceeded.",
        toolCalls
      })
    ).toEqual({
      attemptId: "worker-1-attempt-1",
      workerId: "worker-1",
      command: "",
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      aborted: false,
      passed: false,
      explanation: "",
      failureReason: "Worker Tool call limit exceeded.",
      durationMs: 0,
      runnerFailure: null,
      runnerCleanup: null,
      score: {
        value: 0,
        breakdown: {
          correctness: 0,
          stdoutQuality: 0,
          stderrQuality: 0,
          expectedOutput: 0
        }
      },
      state: "idle",
      stopReason: "",
      toolCalls
    });
  });

  it("creates worker candidate from final passing attempt", () => {
    const finalAttempt = {
      command: "printf 'ok\\n'",
      stdout: "ok\n",
      explanation: "Emit ok.",
      passed: true,
      failureReason: "Matches expected output.",
      score: { value: 100, breakdown: { correctness: 40 } }
    };

    const candidate = createWorkerCandidate({
      task,
      attempts: [finalAttempt],
      finalAttempt,
      finalReason: finalAttempt.failureReason,
      lastExplanation: "",
      engineName: "test-engine"
    });

    expect(candidate).toEqual({
      candidateId: "worker-1",
      workerId: "worker-1",
      strategy: "default",
      command: "printf 'ok\\n'",
      output: "ok",
      explanation: "Emit ok.",
      attempts: [finalAttempt],
      finalCheck: {
        passed: true,
        iterations: 1,
        engine: "test-engine",
        reason: "Matches expected output.",
        score: { value: 100, breakdown: { correctness: 40 } }
      }
    });
  });

  it("creates worker summary with strategy profile and reason", () => {
    const summary = createWorkerSummary({
      task,
      attempts: [{ attemptId: "worker-1-attempt-1" }],
      finalCheck: {
        passed: false,
        reason: "No successful attempt."
      },
      finalState: "stopped"
    });

    expect(summary).toEqual({
      workerId: "worker-1",
      strategy: "default",
      strategyProfile: task.strategyProfile,
      attemptCount: 1,
      passed: false,
      state: "stopped",
      reason: "No successful attempt."
    });
  });
});

describe("runWorkerAttempt", () => {
  it("preserves Runner results supplied through class accessors", async () => {
    class AccessorRunResult {
      get stdout() { return "ok"; }
      get stderr() { return "warning"; }
      get exitCode() { return 0; }
      get timedOut() { return false; }
      get durationMs() { return 7; }
      get failure() { return { type: "diagnostic", message: "Runner diagnostic" }; }
      get cleanup() { return { attempted: true, exitCode: 0, stderr: "" }; }
    }
    const result = await runWorkerAttempt({
      session: { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp",
        engine: { generateCommand: async () => ({ command: "printf ok" }) },
        runner: { run: async () => new AccessorRunResult() },
        judge: { judge: async input => ({
          passed: input.stdout === "ok" && input.stderr === "warning" && input.exitCode === 0 && input.timedOut === false,
          reason: "judged", score: { value: 1 }
        }) } },
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 }, control: {},
      workerState: { abortController: new AbortController() }, iteration: 0, attempts: []
    });
    expect(result).toStrictEqual({ kind: "passed", attempt: {
      attemptId: "worker-1-attempt-1", workerId: "worker-1", command: "printf ok",
      stdout: "ok", stderr: "warning", exitCode: 0, timedOut: false, aborted: false,
      durationMs: 7, runnerFailure: { type: "diagnostic", message: "Runner diagnostic" },
      runnerCleanup: { attempted: true, exitCode: 0, stderr: "" },
      passed: true, explanation: undefined, failureReason: "judged", score: { value: 1 }, toolCalls: []
    } });
  });

  it.each([true, false])("returns an explicit judged outcome for passed=%s", async passed => {
    const result = await runWorkerAttempt({
      session: { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp",
        engine: { generateCommand: async () => ({ command: "printf ok", explanation: "Print ok" }) },
        runner: { run: async () => ({ stdout: "ok", stderr: "", exitCode: 0, timedOut: false }) },
        judge: { judge: async () => ({ passed, reason: "judged", score: { value: 1 } }) } },
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 }, control: {},
      workerState: { abortController: new AbortController() }, iteration: 0, attempts: []
    });
    expect(Object.keys(result).sort()).toEqual(["attempt", "kind"]);
    expect(result).toStrictEqual({ kind: passed ? "passed" : "retry", attempt: {
      attemptId: "worker-1-attempt-1", workerId: "worker-1", command: "printf ok",
      stdout: "ok", stderr: "", exitCode: 0, timedOut: false, aborted: false,
      durationMs: undefined, runnerFailure: null, runnerCleanup: null,
      passed, explanation: "Print ok", failureReason: "judged", score: { value: 1 }, toolCalls: []
    } });
  });

  it("returns a stopped outcome without an attempt when the deadline expires before running", async () => {
    const runnerRun = vi.fn();
    const result = await runWorkerAttempt({
      session: { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp", deadlineAtMs: Date.now() - 1,
        engine: { generateCommand: async () => ({ command: "printf ok", explanation: "Print ok" }) }, runner: { run: runnerRun } },
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 }, control: {},
      workerState: { abortController: new AbortController() }, iteration: 0, attempts: []
    });
    expect(result).toEqual({ kind: "stopped", attempt: null, reason: "Stopped because the overall time budget was exhausted.", explanation: "Print ok" });
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it.each(["aborted-result", "successful-result-race", "runner-rejection"])("propagates external session cancellation during Runner %s", async outcome => {
    const sessionController = new AbortController();
    const reason = new Error("external cancellation");
    const judge = { judge: vi.fn() };
    const workerState = { abortController: new AbortController() };
    const session = { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp", signal: sessionController.signal,
      engine: { generateCommand: async () => ({ command: "printf ok" }) }, judge,
      runner: { run: async (_command, { signal }) => {
        sessionController.abort(reason);
        expect(signal.aborted).toBe(true);
        if (outcome === "runner-rejection") throw new DOMException("Runner interrupted", "AbortError");
        return { stdout: "ok", stderr: "", exitCode: 0, aborted: outcome === "aborted-result", durationMs: 1 };
      } } };
    await expect(runWorkerAttempt({ session, control: {}, task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
      workerState, iteration: 0, attempts: [] })).rejects.toBe(reason);
    expect(judge.judge).not.toHaveBeenCalled();
    expect(workerState.phase).toBe("idle");
  });

  it.each(["worker", "deadline"])("preserves Runner aborted metadata during routine %s cancellation", async source => {
    const workerController = new AbortController();
    const sessionController = new AbortController();
    const control = {};
    const runResult = { stdout: "partial", stderr: "", exitCode: null, aborted: true, timedOut: false, durationMs: 7,
      failure: { kind: "aborted", message: "Runner aborted" }, cleanup: { completed: true } };
    const session = { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp", signal: sessionController.signal,
      engine: { generateCommand: async () => ({ command: "printf ok" }) },
      runner: { run: async () => {
        if (source === "deadline") { session.deadlineAtMs = Date.now() - 1; sessionController.abort(new Error("Solve time budget exceeded.")); }
        else { control.stopRequested = true; control.stopReason = "control stopped Worker"; workerController.abort(); }
        return runResult;
      } } };
    const result = await runWorkerAttempt({ session, control, task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
      workerState: { abortController: workerController }, iteration: 0, attempts: [] });
    expect(result.kind).toBe("stopped");
    expect(result.reason).toBe(source === "deadline" ? "Stopped because the overall time budget was exhausted." : "control stopped Worker");
    expect(result.attempt).toStrictEqual({
      attemptId: "worker-1-attempt-1", workerId: "worker-1", command: "printf ok",
      stdout: "partial", stderr: "", exitCode: null, timedOut: false, aborted: true,
      durationMs: 7, runnerFailure: runResult.failure, runnerCleanup: runResult.cleanup,
      passed: false, explanation: undefined, failureReason: result.reason, toolCalls: [],
      score: { value: 0, breakdown: { correctness: 0, stdoutQuality: 0, stderrQuality: 0, expectedOutput: 0 } }
    });
  });

  it("preserves a sparse stopped attempt when the Judge throws", async () => {
    const result = await runWorkerAttempt({
      session: { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp",
        engine: { generateCommand: async () => ({ command: "printf ok" }) },
        runner: { run: async () => ({ stdout: "ok", stderr: "", exitCode: 0, timedOut: false }) },
        judge: { judge: async () => { throw new Error("Judge unavailable"); } } },
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 }, control: {},
      workerState: { abortController: new AbortController() }, iteration: 0, attempts: []
    });
    expect(result).toMatchObject({ kind: "stopped", reason: "Judge unavailable", attempt: { passed: false, failureReason: "Judge unavailable" } });
    expect(result.attempt).toStrictEqual({
      attemptId: "worker-1-attempt-1", workerId: "worker-1", command: "printf ok",
      passed: false, explanation: undefined, failureReason: "Judge unavailable", toolCalls: [],
      score: { value: 0, breakdown: { correctness: 0, stdoutQuality: 0, stderrQuality: 0, expectedOutput: 0 } }
    });
  });

  it("preserves existing unrelated Runner failure results", async () => {
    const session = { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp",
      engine: { generateCommand: async () => ({ command: "printf ok" }) },
      runner: { run: async () => { throw new Error("Runner unavailable"); } } };
    const result = await runWorkerAttempt({ session, control: {}, task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
      workerState: { abortController: new AbortController() }, iteration: 0, attempts: [] });
    expect(result).toMatchObject({ kind: "stopped", reason: "Runner unavailable", attempt: { command: "printf ok", passed: false, failureReason: "Runner unavailable" } });
    expect(Object.keys(result.attempt).sort()).toEqual([
      "attemptId", "command", "explanation", "failureReason", "passed", "score", "toolCalls", "workerId"
    ]);
  });

  it.each(["session", "worker"])("links %s cancellation to command generation", async source => {
    const sessionController = new AbortController();
    const workerController = new AbortController();
    let received;
    const generateCommand = vi.fn(async (_context, { signal }) => {
      received = signal;
      (source === "session" ? sessionController : workerController).abort(new Error("cancel generation"));
      signal.throwIfAborted();
      return { command: "printf ok" };
    });
    const runnerRun = vi.fn();
    const outcome = runWorkerAttempt({ session: { generation: "command", knowledgeMode: "off",
      problem: { problemText: "print ok" }, workdir: "/tmp", engine: { generateCommand },
      runner: { run: runnerRun }, signal: sessionController.signal
    }, task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 }, control: {},
      workerState: { abortController: workerController }, iteration: 0, attempts: []
    });
    if (source === "session") await expect(outcome).rejects.toThrow("cancel generation");
    else await expect(outcome).resolves.toMatchObject({ kind: "stopped", reason: "Execution was stopped.", attempt: null });
    expect(received.aborted).toBe(true);
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("handles a control stop after generation before entering the Runner", async () => {
    const workerController = new AbortController();
    const control = {};
    const runnerRun = vi.fn();
    const session = { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp",
      engine: { generateCommand: async () => ({ command: "printf ok" }) }, runner: { run: runnerRun },
      onProgress: event => { if (event.type === "attempt-started") {
        control.stopRequested = true; control.stopReason = "stopped before Runner"; workerController.abort();
      } } };
    await expect(runWorkerAttempt({ session, control,
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
      workerState: { abortController: workerController }, iteration: 0, attempts: []
    })).resolves.toMatchObject({ kind: "stopped", reason: "stopped before Runner", attempt: null });
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("recognizes cancellation error names at the unknown provider boundary", async () => {
    const workerController = new AbortController();
    const result = await runWorkerAttempt({
      session: { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp",
        engine: { generateCommand: async () => { workerController.abort(); throw { name: "AbortError" }; } } },
      control: { stopRequested: true, stopReason: "scheduler stop" },
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
      workerState: { abortController: workerController }, iteration: 0, attempts: []
    });
    expect(result).toEqual({ kind: "stopped", reason: "scheduler stop", attempt: null, explanation: "" });
  });

  it("preserves provider exceptions even when a stop was requested concurrently", async () => {
    const workerController = new AbortController();
    const providerError = new Error("provider unavailable");
    await expect(runWorkerAttempt({ session: { generation: "command", knowledgeMode: "off", problem: { problemText: "print ok" }, workdir: "/tmp",
      engine: { generateCommand: async () => { workerController.abort(); throw providerError; } } },
      control: { stopRequested: true, stopReason: "stop requested" },
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
      workerState: { abortController: workerController }, iteration: 0, attempts: []
    })).rejects.toBe(providerError);
  });

  it("forwards normalized read-only Docker devices to the runner", async () => {
    const runnerRun = vi.fn(async () => ({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      durationMs: 1
    }));
    const session = { generation: "command", knowledgeMode: "off",
      problem: { problemText: "Print ok", expectedOutput: "ok" },
      workdir: "/tmp",
      commandPolicy: undefined,
      engine: {
        generateCommand: vi.fn(async () => ({
          command: "printf 'ok\\n'",
          explanation: "Print ok."
        }))
      },
      runner: { run: runnerRun },
      judge: {
        judge: vi.fn(async () => ({
          passed: true,
          reason: "ok",
          score: { value: 100, breakdown: {} }
        }))
      },
      runnerLimits: {},
      sandboxPolicy: { networkAccess: "off", filesystemScope: "workdir-only" },
      dockerDevicesReadonly: ["/dev/loop40", "/dev/loop41"],
      progressEvents: []
    };

    await runWorkerAttempt({
      session,
      task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
      control: {},
      workerState: { abortController: new AbortController() },
      iteration: 0,
      attempts: []
    });

    expect(runnerRun).toHaveBeenCalledWith(
      "printf 'ok\\n'",
      expect.objectContaining({
        dockerDevicesReadonly: ["/dev/loop40", "/dev/loop41"]
      })
    );
  });

  it("creates unsafe attempt and skips runner for blocked command", async () => {
    const task = {
      workerId: "worker-1",
      strategy: "default",
      maxAttempts: 1
    };
    const runnerRun = vi.fn();
    const session = { generation: "command", knowledgeMode: "off",
      problem: {
        problemText: "List files",
        expectedOutput: ""
      },
      workdir: "/tmp",
      commandPolicy: undefined,
      engine: {
        generateCommand: vi.fn(async () => ({
          command: "rm -rf /",
          explanation: "Remove everything."
        }))
      },
      runner: {
        run: runnerRun
      },
      progressEvents: []
    };
    const workerState = {
      abortController: new AbortController()
    };

    const result = await runWorkerAttempt({
      session,
      task,
      control: {},
      workerState,
      iteration: 0,
      attempts: []
    });

    expect(result.kind).toBe("stopped");
    expect(result.reason).toContain("Blocked");
    expect(result.attempt).not.toHaveProperty("stdout");
    expect(result.attempt).not.toHaveProperty("stderr");
    expect(result.attempt).toStrictEqual({
      attemptId: "worker-1-attempt-1",
      workerId: "worker-1",
      command: "rm -rf /",
      passed: false,
      explanation: "Remove everything.",
      failureReason: expect.stringContaining("Blocked"),
      score: { value: 0, breakdown: { correctness: 0, stdoutQuality: 0, stderrQuality: 0, expectedOutput: 0 } },
      toolCalls: []
    });
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("turns only Worker Tool loop failures into retryable generation attempts", async () => {
    const task = {
      workerId: "worker-1",
      strategy: "default",
      maxAttempts: 2
    };
    const toolResult = {
      ok: true,
      value: { records: [{ id: "man:awk", text: "do not log this" }] },
      validatedArguments: { query: "awk" }
    };
    const toolRegistry = {
      definitions: vi.fn(() => [{ name: "search_knowledge" }]),
      execute: vi.fn(async () => toolResult)
    };
    const engine = {
      generateTurn: vi
        .fn()
        .mockResolvedValueOnce({
          type: "tool_calls",
          calls: [
            { id: "call-1", name: "search_knowledge", arguments: { query: "awk" } }
          ],
          continuation: { responseId: "response-1" }
        })
        .mockResolvedValueOnce({
          type: "tool_calls",
          calls: [
            { id: "call-2", name: "search_knowledge", arguments: { query: "sed" } }
          ],
          continuation: { responseId: "response-2" }
        })
    };
    const runnerRun = vi.fn();
    const session = { generation: "tools", knowledgeMode: "worker",
      problem: { problemText: "List files", expectedOutput: "" },
      workdir: "/tmp",
      commandPolicy: undefined,
      engine,
      toolRegistry,
      runner: { run: runnerRun },
      progressEvents: []
    };

    const result = await runWorkerAttempt({
      session,
      task,
      control: {},
      workerState: { abortController: new AbortController() },
      iteration: 0,
      attempts: []
    });

    expect(result).toMatchObject({
      kind: "retry",
      attempt: { command: "", passed: false, failureReason: "Worker Tool call limit exceeded." }
    });
    expect(result.attempt).toStrictEqual({
      attemptId: "worker-1-attempt-1", workerId: "worker-1",
      command: "",
      stdout: "", stderr: "", exitCode: null, timedOut: false, aborted: false,
      explanation: "", durationMs: 0, runnerFailure: null, runnerCleanup: null,
      passed: false,
      failureReason: "Worker Tool call limit exceeded.",
      score: { value: 0, breakdown: { correctness: 0, stdoutQuality: 0, stderrQuality: 0, expectedOutput: 0 } },
      state: "idle",
      stopReason: "",
      toolCalls: [
        {
          name: "search_knowledge",
          arguments: { query: "awk" },
          status: "completed",
          resultCount: 1,
          recordIds: ["man:awk"]
        }
      ]
    });
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("preserves unrelated Engine generation exceptions", async () => {
    const providerError = new Error("provider unavailable");
    const session = { generation: "command", knowledgeMode: "off",
      problem: { problemText: "List files", expectedOutput: "" },
      workdir: "/tmp",
      engine: { generateCommand: vi.fn(async () => { throw providerError; }) }
    };

    await expect(
      runWorkerAttempt({
        session,
        task: { workerId: "worker-1", strategy: "default", maxAttempts: 1 },
        control: {},
        workerState: { abortController: new AbortController() },
        iteration: 0,
        attempts: []
      })
    ).rejects.toBe(providerError);
  });
});
