import { describe, expect, it, vi } from "vitest";
import { SimpleJudge } from "../src/execution/judge/simpleJudge.js";
import { runSolveOrchestrator } from "../src/solve/orchestration/orchestrator.js";
import { __testUtils } from "../src/providers/engines/openaiEngine.js";
import { selectSolveOutcome } from "../src/solve/selection/selector.js";

const initial = "printf 'ok\\n'";
const improved = "printf 'ok\\n' | sed s/ok/ok/";
const task = (workerId, maxAttempts = 3) => ({ workerId, strategy: "default", maxAttempts });

function makeSession(commands, options = {}) {
  const engine = {
    name: "test",
    generateCommand: vi.fn(async (context) => {
      const next = commands[context.attempts.length];
      if (next instanceof Error) throw next;
      return { command: next, explanation: `attempt ${context.attempts.length + 1}` };
    })
  };
  return {
    problem: { problemText: "print ok", ...options.problem },
    workdir: "/tmp",
    engine,
    selectorName: options.selectorName ?? "best-score-wins",
    shellgeiScoreMode: "simple",
    runner: { run: vi.fn(async command => ({
      stdout: command.includes("different") ? "different\n" : "ok\n",
      stderr: "", exitCode: command.includes("false") ? 1 : 0, durationMs: 1
    })) },
    judge: new SimpleJudge(),
    plan: { parallelism: 1, workerTasks: [task("worker-1", options.maxAttempts ?? commands.length)] },
    ...options.session
  };
}

describe("worker improvement", () => {
  it("uses remaining attempts, gives the best score to the engine, and selects the highest scoring passing attempt", async () => {
    const session = makeSession([initial, improved, initial]);
    const result = await runSolveOrchestrator(session);
    const candidate = result.candidates[0];
    expect(session.engine.generateCommand).toHaveBeenCalledTimes(3);
    expect(session.engine.generateCommand.mock.calls[1][0].bestCandidate).toMatchObject({
      attemptId: "worker-1-attempt-1", command: initial, shellgeiScore: { breakdown: expect.any(Object) }
    });
    expect(session.engine.generateCommand.mock.calls[2][0].bestCandidate.command).toBe(improved);
    expect(candidate).toMatchObject({ command: improved, selectedAttemptId: "worker-1-attempt-2", finalCheck: { passed: true, iterations: 3 } });
    expect(candidate.shellgeiScore).toEqual(result.attempts[1].shellgeiScore);
    expect(result.attempts[1].shellgeiScore.value).toBeGreaterThan(result.attempts[0].shellgeiScore.value);
    expect(result.attempts[0].shellgeiScore).toEqual(result.attempts[2].shellgeiScore);
  });

  it.each([
    ["different output", "printf 'different\\n'", "Output did not match the first passing attempt."],
    ["judge failure", "false", "Command exited with code 1."],
    ["unsafe command", "rm -rf /", "Blocked"],
    ["generation error", new Error("provider unavailable"), "Command generation failed during improvement."]
  ])("preserves a successful attempt after %s", async (_label, next, reason) => {
    const session = makeSession([initial, next], { maxAttempts: 2 });
    const result = await runSolveOrchestrator(session);
    expect(result.candidates[0]).toMatchObject({ command: initial, selectedAttemptId: "worker-1-attempt-1", finalCheck: { passed: true } });
    expect(result.attempts[1]).toMatchObject({ passed: false, failureReason: expect.stringContaining(reason) });
    if (next instanceof Error) expect(JSON.stringify(result)).not.toContain(next.message);
    if (typeof next === "string" && next.startsWith("rm")) expect(session.runner.run).toHaveBeenCalledTimes(1);
  });

  it("checks expected output and respects the one-attempt limit", async () => {
    const mismatch = await runSolveOrchestrator(makeSession([initial, "printf 'different\\n'"], { problem: { expectedOutput: "ok" } }));
    expect(mismatch.attempts[1]).toMatchObject({ passed: false, failureReason: "Output did not match expected output." });
    const one = makeSession([initial, improved], { maxAttempts: 1 });
    const result = await runSolveOrchestrator(one);
    expect(result.candidates[0].command).toBe(initial);
    expect(one.engine.generateCommand).toHaveBeenCalledOnce();
  });

  it.each(["first-pass-wins", "best-score-wins"])("retains the successful attempt when the time budget expires during improvement with %s", async selectorName => {
    const session = makeSession([initial, improved], { selectorName });
    session.deadlineAtMs = Date.now() + 250;
    session.engine.generateCommand.mockImplementation(async (context, { signal }) => {
      if (!context.bestCandidate) return { command: initial };
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const result = await runSolveOrchestrator(session);
    expect(result.candidates[0]).toMatchObject({ command: initial, finalCheck: { passed: true } });
    expect(result.stopReason).toContain("time budget");
  });

  it("propagates an external cancellation during improvement", async () => {
    const controller = new AbortController();
    const session = makeSession([initial, improved], { session: { signal: controller.signal } });
    const cancellation = new Error("cancelled by user");
    session.engine.generateCommand.mockImplementation(async context => {
      if (!context.bestCandidate) return { command: initial };
      controller.abort(cancellation);
      throw cancellation;
    });
    await expect(runSolveOrchestrator(session)).rejects.toBe(cancellation);
  });

  it("stops other workers immediately, improves the first winner, and selects it despite task ordering", async () => {
    const session = makeSession([initial, improved], { selectorName: "first-pass-wins" });
    session.plan = { parallelism: 2, workerTasks: [task("slow", 2), task("fast", 2)] };
    session.engine.generateCommand.mockImplementation(async (context, { signal }) => {
      if (context.workerId === "fast") return { command: context.bestCandidate ? improved : initial };
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const execution = await runSolveOrchestrator(session);
    expect(execution.passingCandidateId).toBe("fast");
    expect(execution.candidates.find(candidate => candidate.workerId === "fast")).toMatchObject({ command: improved, finalCheck: { passed: true, iterations: 2 } });
    const selected = selectSolveOutcome(execution.candidates, "first-pass-wins", execution.passingCandidateId);
    expect(selected.selectedCandidate.workerId).toBe("fast");
  });

  it("selects the first successful worker even when another passing worker is earlier in task order", () => {
    const candidates = ["slow", "fast"].map(candidateId => ({ candidateId, finalCheck: { passed: true } }));
    expect(selectSolveOutcome(candidates, "first-pass-wins", "fast").selectedCandidate.candidateId).toBe("fast");
  });

  it("runs the tool loop again during improvement and passes it the best candidate", async () => {
    const session = makeSession([initial, improved]);
    const contexts = [];
    session.toolRegistry = {
      definitions: () => [{ name: "search_knowledge" }],
      execute: vi.fn(async () => ({ ok: true, value: { records: [{ id: "one", text: "private record" }] }, validatedArguments: { query: "sed" } }))
    };
    session.engine.generateTurn = vi.fn(async ({ context, continuation }) => {
      contexts.push(context);
      if (!context.bestCandidate) return { type: "command", command: initial };
      if (!continuation) return { type: "tool_calls", calls: [{ id: "call", name: "search_knowledge", arguments: { query: "sed" } }], continuation: {} };
      return { type: "command", command: improved };
    });
    const result = await runSolveOrchestrator(session);
    expect(contexts[1].bestCandidate.command).toBe(initial);
    expect(session.toolRegistry.execute).toHaveBeenCalledOnce();
    expect(result.candidates[0].command).toBe(improved);
    expect(result.attempts[1].toolCalls).toEqual([{ name: "search_knowledge", arguments: { query: "sed" }, status: "completed", resultCount: 1, recordIds: ["one"] }]);
    expect(JSON.stringify(result)).not.toContain("private record");
  });

  it("includes improvement instructions in the shared API prompt for normal and tool turns", () => {
    const prompt = __testUtils().buildUserPrompt({ problem: "print ok", workdir: "/tmp", attempts: [],
      bestCandidate: { attemptId: "a1", command: initial, shellgeiScore: { value: 42, breakdown: {} } } });
    expect(prompt).toContain("Improve its shell-gei score");
    expect(prompt).toContain("Best passing attempt:");
    expect(prompt).toContain('"value":42');
  });
});
