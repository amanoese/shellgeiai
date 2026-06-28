import { describe, expect, it } from "vitest";

import { formatResult } from "../src/io/formatter/formatResult.js";

describe("formatResult", () => {
  it("includes rubric breakdown, notes, penalties, planner provider, and worker variants", () => {
    const output = formatResult({
      command: "printf '42\\n'",
      output: "42",
      explanation: "Prints the agreed answer.",
      finalCheck: {
        passed: true,
        iterations: 1,
        engine: "openai",
        reason: "Output matched expected output."
      },
      selector: {
        name: "best-score-wins",
        selectedCandidateId: "worker-2",
        reason: "Selected worker-2 as best passing candidate; it won on shellgei score.",
        score: {
          value: 100,
          breakdown: {
            correctness: 60,
            stdoutQuality: 15,
            stderrQuality: 10,
            expectedOutput: 15
          }
        },
        metrics: {
          totalScore: 187,
          shellgeiScore: 72,
          rubricBreakdown: {
            conciseness: 13,
            shellness: 14,
            ingenuity: 12,
            readability: 11,
            robustness: 12,
            artistry: 10
          },
          judgeScore: 100,
          stdoutConsistency: 10,
          outputConsensus: 5,
          totalDurationMs: 8,
          iterationCount: 1,
          commandLength: 12,
          explanationLength: 26
        }
      },
      runner: {
        name: "local",
        sandboxPolicy: {
          networkAccess: "off",
          filesystemScope: "workspace-write"
        }
      },
      stopReason: null,
      logPath: "/tmp/solve.json",
        plan: {
          knowledgeMode: "worker",
          planner: {
            provider: "llm",
            attemptedProvider: "llm",
            fallbackReason: null
        },
        workerTasks: [
          {
            workerId: "worker-1",
            assignedVariant: {
              variantId: "variant-awk",
              label: "awk-first",
              approach: "awk-record-pass",
              toolBias: ["awk"]
            }
          },
          {
            workerId: "worker-2",
            assignedVariant: {
              variantId: "variant-factor",
              label: "factor-first",
              approach: "external-utility",
              toolBias: ["seq", "factor", "awk"]
            }
          }
        ]
      },
      candidates: [
        {
          candidateId: "worker-1",
          workerId: "worker-1",
          command: "awk 'BEGIN{print 42}'",
          shellgeiScore: {
            value: 65,
            mode: "simple",
            breakdown: {
              conciseness: 12,
              shellness: 13,
              ingenuity: 10,
              readability: 10,
              robustness: 10,
              artistry: 10
            },
            notes: [],
            penalties: []
          },
          finalCheck: {
            passed: true,
            iterations: 1,
            reason: "Output matched expected output."
          }
        },
        {
          candidateId: "worker-2",
          workerId: "worker-2",
          command: "printf '42\\n'",
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
            notes: ["Uses single awk pass"],
            penalties: ["Avoid useless use of cat"]
          },
          finalCheck: {
            passed: true,
            iterations: 1,
            reason: "Output matched expected output."
          }
        }
      ]
    });

    expect(output).toContain("selected-shellgei-score: 72");
    expect(output).toContain("shellgei-breakdown: conciseness=13, shellness=14");
    expect(output).toContain("shellgei-notes: Uses single awk pass");
      expect(output).toContain("shellgei-penalties: Avoid useless use of cat");
      expect(output).toContain("planner-provider: llm");
      expect(output).toContain(
        "worker-1 # score: 65 # knowledge: on # [awk] # awk 'BEGIN{print 42}'"
      );
      expect(output).toContain(
        "worker-2 # score: 72 # knowledge: on # [seq,factor,awk] # printf '42\\n'"
      );
    });

    it("marks worker variants knowledge off when disabled", () => {
      const output = formatResult({
        command: "printf '42\\n'",
        output: "42",
        explanation: "Prints agreed answer.",
        finalCheck: { passed: true, iterations: 1, engine: "mock", reason: "ok" },
        selector: { name: "best-score-wins", selectedCandidateId: "worker-1", reason: "ok" },
        runner: { name: "local" },
        plan: {
          knowledgeMode: "off",
          workerTasks: [
            {
              workerId: "worker-1",
              assignedVariant: {
                toolBias: ["awk"]
              }
            }
          ]
        },
        candidates: [
          {
            candidateId: "worker-1",
            workerId: "worker-1",
            command: "printf '42\\n'",
            finalCheck: { passed: true }
          }
        ]
      });

      expect(output).toContain("worker-1 # score: 0 # knowledge: off # [awk] # printf '42\\n'");
    });
  });
