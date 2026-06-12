# Shellgei Quality Loop Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
**Goal:** `docs/shellgei_llm_rubric.md` を実装へ接続し、正答性の門番とシェル芸品質評価を分離した `Two-layer quality loop` を導入して、生成されるコマンドのシェル芸としての完成度を上げる。
**Architecture:** `judge` は引き続き pass/fail と失格条件の判定を担い、rubric に基づく品質評価は独立した `shellgei scorer` で行う。`planner` と各 `engine` は rubric を踏まえた役割と再試行指針を受け取り、`selector` は judge 結果だけでなく品質評価も使って最終候補を選ぶ。結果表示とログには、どの候補がなぜ「シェル芸として良い」と判断されたかを追える情報を残す。
**Tech Stack:** Node.js, Vitest, 既存 `src/core/*`, `src/engines/*`, `src/judge/*`, `src/formatter/*`, `src/logs/*`

---

## 方針

- 既存の `SimpleJudge` は「正しく動くか」「失格条件に当たらないか」を判定する門番として残す
- `shellgei score` は `judge` と別系統で計算し、rubric の配点に対応した breakdown を返す
- 生成系プロンプトと worker strategy へ rubric を短く注入し、候補生成と評価の観点を揃える
- `selector` は `best-score-wins` で rubric ベースの品質評価を第一信号にし、同点時のみ既存の安定性・合意・実行時間で比較する
- 出力とログに「高得点理由」と「減点理由」を載せ、あとから改善しやすくする

## 非目標

- この計画では LLM 自身に rubric 全採点を全文生成させる仕組みまでは導入しない
- Docker runner の安全制約や command policy 自体を緩める変更は含めない
- 新しい外部 API や学習基盤は導入しない

## タスク 1: rubric 対応の品質スコアモデルを定義する

**Files:**
- Modify: `src/core/types.js`
- Modify: `src/core/shellgeiScorer.js`
- Test: `test/shellgeiScorer.test.js`

- [ ] **Step 1: 品質スコア shape をテストで先に固定する**

```js
import { describe, expect, it } from "vitest";
import { scoreShellgeiCandidate } from "../src/core/shellgeiScorer.js";

describe("scoreShellgeiCandidate", () => {
  it("returns rubric-aligned breakdown for passing candidates", () => {
    const result = scoreShellgeiCandidate({
      command: "awk -F, '$3>10{sum+=$3} END{print sum}' sample.csv",
      explanation: "Use awk once instead of a longer pipeline.",
      finalCheck: { passed: true },
      attempts: [{ durationMs: 12, stdout: "42\n" }]
    });

    expect(result).toEqual({
      value: expect.any(Number),
      mode: "standard",
      breakdown: {
        conciseness: expect.any(Number),
        shellness: expect.any(Number),
        ingenuity: expect.any(Number),
        readability: expect.any(Number),
        robustness: expect.any(Number),
        artistry: expect.any(Number)
      },
      notes: expect.any(Array),
      penalties: expect.any(Array)
    });
  });
});
```

- [ ] **Step 2: テストを実行して現状との差分を確認する**
Run: `npm test -- test/shellgeiScorer.test.js`
Expected: FAIL with missing `mode`, missing rubric keys, or old `shortness/simplicity/speed` breakdown

- [ ] **Step 3: rubric に対応した scorer を最小実装する**

```js
const DEFAULT_MODE = "standard";

function hasUselessCat(command) {
  return /\bcat\s+\S+\s+\|\s+/.test(command);
}

function scoreConciseness(command) {
  const lengthPenalty = Math.min(8, Math.floor((command.length || 0) / 24));
  const catPenalty = hasUselessCat(command) ? 2 : 0;
  return Math.max(0, 15 - lengthPenalty - catPenalty);
}

function scoreShellness(command) {
  const usesPipeline = command.includes("|");
  const usesUnixTool = /\b(awk|sed|grep|sort|uniq|cut|tr|paste|xargs|find)\b/.test(command);
  return Math.min(15, (usesPipeline ? 7 : 0) + (usesUnixTool ? 8 : 3));
}

export function scoreShellgeiCandidate(candidate, options = {}) {
  if (!candidate.finalCheck?.passed) {
    return null;
  }

  const command = candidate.command ?? "";
  const mode = options.mode ?? DEFAULT_MODE;
  const breakdown = {
    conciseness: scoreConciseness(command),
    shellness: scoreShellness(command),
    ingenuity: 0,
    readability: 0,
    robustness: 0,
    artistry: 0
  };

  return {
    value: Object.values(breakdown).reduce((sum, score) => sum + score, 0),
    mode,
    breakdown,
    notes: [],
    penalties: hasUselessCat(command) ? ["Avoid useless use of cat."] : []
  };
}
```

- [ ] **Step 4: 型定義を rubric 向け shape に更新する**

```js
/**
 * @typedef {"standard" | "competition" | "practical" | "appreciation"} ShellgeiScoreMode
 */

/**
 * @typedef {Object} ShellgeiScore
 * @property {number} value
 * @property {ShellgeiScoreMode} mode
 * @property {{conciseness: number, shellness: number, ingenuity: number, readability: number, robustness: number, artistry: number}} breakdown
 * @property {string[]} notes
 * @property {string[]} penalties
 */
```

- [ ] **Step 5: scorer テストを再実行して通過を確認する**
Run: `npm test -- test/shellgeiScorer.test.js`
Expected: PASS

## タスク 2: judge を「正答性と失格条件の門番」として明確化する

**Files:**
- Modify: `src/judge/simpleJudge.js`
- Modify: `src/core/types.js`
- Test: `test/simpleJudge.test.js`

- [ ] **Step 1: 失格条件の扱いをテストで固定する**

```js
it("fails commands that only pass by producing stderr noise", async () => {
  const judge = new SimpleJudge();

  await expect(
    judge.judge({
      command: "awk 'BEGIN{print 42; print \"boom\" > \"/dev/stderr\"}'",
      stdout: "42\n",
      stderr: "boom\n",
      exitCode: 0,
      timedOut: false,
      expectedOutput: "42\n"
    })
  ).resolves.toMatchObject({
    passed: false,
    reason: "stderr was not empty."
  });
});
```

- [ ] **Step 2: テストを実行して既存挙動を確認する**
Run: `npm test -- test/simpleJudge.test.js`
Expected: PASS or FAIL; capture current behavior before changing score payload

- [ ] **Step 3: judge の返却値に quality layer 用の gate 情報を載せる**

```js
function buildDecision(input, result) {
  return {
    passed: result.passed,
    reason: result.reason,
    score: {
      value: Object.values(result.breakdown).reduce((sum, score) => sum + score, 0),
      breakdown: result.breakdown
    },
    gate: {
      disqualified: !result.passed,
      stderrAllowed: result.stderrAllowed,
      expectedOutputMatched: result.passedExpectedOutput
    }
  };
}
```

- [ ] **Step 4: 型定義へ judge gate 情報を追加する**

```js
/**
 * @property {{disqualified: boolean, stderrAllowed: boolean, expectedOutputMatched: boolean}} [gate]
 */
```

- [ ] **Step 5: judge テストを再実行して gate 情報つきで通ることを確認する**
Run: `npm test -- test/simpleJudge.test.js`
Expected: PASS

## タスク 3: planner と engine prompt を rubric 準拠にする

**Files:**
- Modify: `src/core/planner.js`
- Modify: `src/engines/openaiEngine.js`
- Modify: `src/engines/codexCliEngine.js`
- Modify: `src/core/types.js`
- Test: `test/runtimePlanner.test.js`
- Test: `test/openaiEngine.test.js`

- [ ] **Step 1: worker strategy が rubric の観点を持つことをテストで先に固定する**

```js
expect(plan.workerTasks[0].strategyProfile).toEqual(
  expect.objectContaining({
    rubricFocus: expect.any(Array),
    retryHint: expect.stringContaining("Remove redundant stages")
  })
);
```

- [ ] **Step 2: OpenAI prompt が rubric guidance を含むことをテストで固定する**

```js
const prompt = buildUserPrompt({
  problem: "sum third column",
  attempts: [],
  workdir: "/tmp/workdir",
  workerTask: {
    workerId: "worker-1",
    strategy: "awk-first",
    strategyProfile: {
      name: "awk-centric",
      focus: "Prefer awk for record-wise transforms.",
      retryHint: "Remove redundant stages before switching tools.",
      rubricFocus: ["conciseness", "shellness", "readability"]
    },
    maxAttempts: 3
  }
});

expect(prompt).toContain("Shellgei rubric focus:");
expect(prompt).toContain("conciseness, shellness, readability");
```

- [ ] **Step 3: planner に rubric focus を持つ strategy catalog を追加する**

```js
const strategyCatalog = [
  {
    strategy: "default",
    name: "balanced-search",
    focus: "Start with a direct safe one-liner.",
    retryHint: "Remove redundant stages before changing the whole approach.",
    rubricFocus: ["conciseness", "shellness", "robustness"]
  },
  {
    strategy: "awk-first",
    name: "awk-centric",
    focus: "Prefer awk for record-wise transforms.",
    retryHint: "Keep it to one data pass when possible.",
    rubricFocus: ["shellness", "readability", "ingenuity"]
  }
];
```

- [ ] **Step 4: engine prompt に rubric を短く注入する**

```js
"Prefer a shell-gei style one-liner.",
"Favor natural stdin/stdout flow and standard Unix tools.",
"Avoid redundant cat, duplicated passes, temporary files, or embedded scripts.",
workerTask?.strategyProfile?.rubricFocus?.length
  ? `Shellgei rubric focus: ${workerTask.strategyProfile.rubricFocus.join(", ")}`
  : ""
```

- [ ] **Step 5: planner / engine テストを再実行して通過を確認する**
Run: `npm test -- test/runtimePlanner.test.js test/openaiEngine.test.js`
Expected: PASS

## タスク 4: solve 結果と selector を rubric ベースの品質比較へ切り替える

**Files:**
- Modify: `src/core/solve.js`
- Modify: `src/core/selector.js`
- Modify: `src/core/types.js`
- Test: `test/selector.test.js`
- Test: `test/solveFlow.test.js`

- [ ] **Step 1: selector が rubric breakdown を優先比較することをテストで固定する**

```js
expect(result.metrics).toEqual(
  expect.objectContaining({
    shellgeiScore: expect.any(Number),
    rubricBreakdown: expect.objectContaining({
      conciseness: expect.any(Number),
      shellness: expect.any(Number)
    })
  })
);
expect(result.reason).toContain("won on shellgei score");
```

- [ ] **Step 2: solve が score mode を scorer へ渡すことをテストで固定する**

```js
expect(result.candidates[0].shellgeiScore).toEqual(
  expect.objectContaining({
    mode: "standard",
    breakdown: expect.objectContaining({
      conciseness: expect.any(Number)
    })
  })
);
```

- [ ] **Step 3: selector metrics を rubric 対応 shape に更新する**

```js
return {
  totalScore,
  shellgeiScore,
  rubricBreakdown: candidate.shellgeiScore?.breakdown ?? null,
  judgeScore,
  stdoutConsistency,
  outputConsensus,
  totalDurationMs,
  iterationCount,
  commandLength,
  explanationLength
};
```

- [ ] **Step 4: solve の finalize で score mode と gate 情報を保持したまま再採点する**

```js
const candidates = execution.candidates.map((candidate) => (
  candidate.finalCheck?.passed
    ? {
        ...candidate,
        shellgeiScore: scoreShellgeiCandidate(candidate, {
          mode: session.shellgeiScoreMode
        })
      }
    : candidate
));
```

- [ ] **Step 5: selector / solve テストを再実行して通過を確認する**
Run: `npm test -- test/selector.test.js test/solveFlow.test.js`
Expected: PASS

## タスク 5: 出力とログに品質評価の理由を残す

**Files:**
- Modify: `src/formatter/formatResult.js`
- Modify: `src/logs/writer.js`
- Modify: `src/core/types.js`
- Test: `test/formatResult.test.js`
- Test: `test/logWriter.test.js`

- [ ] **Step 1: 結果表示に rubric breakdown と notes/penalties を出すことをテストで固定する**

```js
expect(output).toContain("selected-shellgei-score: 72");
expect(output).toContain("shellgei-breakdown: conciseness=13, shellness=14");
expect(output).toContain("shellgei-notes: Uses a single awk pass");
expect(output).toContain("shellgei-penalties: Avoid useless use of cat");
```

- [ ] **Step 2: ログに score mode と notes/penalties が保存されることをテストで固定する**

```js
expect(logContent.candidates[0].shellgeiScore).toEqual(
  expect.objectContaining({
    mode: "standard",
    notes: expect.any(Array),
    penalties: expect.any(Array)
  })
);
```

- [ ] **Step 3: formatter と log writer を rubric 対応 shape へ更新する**

```js
`selected-shellgei-score: ${selectedShellgeiScore?.value ?? 0}`,
`shellgei-breakdown: conciseness=${selectedShellgeiScore?.breakdown.conciseness ?? 0}, shellness=${selectedShellgeiScore?.breakdown.shellness ?? 0}, ingenuity=${selectedShellgeiScore?.breakdown.ingenuity ?? 0}, readability=${selectedShellgeiScore?.breakdown.readability ?? 0}, robustness=${selectedShellgeiScore?.breakdown.robustness ?? 0}, artistry=${selectedShellgeiScore?.breakdown.artistry ?? 0}`,
`shellgei-notes: ${(selectedShellgeiScore?.notes ?? []).join("; ") || "(none)"}`,
`shellgei-penalties: ${(selectedShellgeiScore?.penalties ?? []).join("; ") || "(none)"}`
```

- [ ] **Step 4: selector metrics の log 保存 shape も更新する**

```js
metrics: {
  totalScore: summary.selectorMetrics?.totalScore ?? 0,
  rubricBreakdown: summary.selectorMetrics?.rubricBreakdown ?? null,
  shellgeiScore: summary.selectorMetrics?.shellgeiScore ?? 0
}
```

- [ ] **Step 5: formatter / log テストを再実行して通過を確認する**
Run: `npm test -- test/formatResult.test.js test/logWriter.test.js`
Expected: PASS

## タスク 6: score mode 設定と docs を仕上げる

**Files:**
- Modify: `src/core/solveSession.js`
- Modify: `src/core/types.js`
- Modify: `src/cliOptions.js`
- Modify: `README.md`
- Modify: `docs/shellgei_llm_rubric.md`
- Test: `test/cliOptions.test.js`

- [ ] **Step 1: CLI から score mode を指定できることをテストで固定する**

```js
expect(parseCliOptions([
  "solve",
  "print 42",
  "--shellgei-score-mode",
  "practical"
])).toEqual(
  expect.objectContaining({
    shellgeiScoreMode: "practical"
  })
);
```

- [ ] **Step 2: solve session が既定値 `standard` を使うことをテストで固定する**

```js
expect(session.shellgeiScoreMode).toBe("standard");
```

- [ ] **Step 3: CLI と session に score mode を通す**

```js
const shellgeiScoreMode =
  options.shellgeiScoreMode ?? "standard";
```

- [ ] **Step 4: README と rubric に実装上の対応関係を追記する**

```md
- `judge`: 正確性・実行可能性と失格条件の gate
- `shellgei score`: 簡潔性、シェルらしさ、発想、可読性、堅牢性、鑑賞性の品質評価
- `selector`: `best-score-wins` で quality layer を優先利用
```

- [ ] **Step 5: CLI テストを再実行して通過を確認する**
Run: `npm test -- test/cliOptions.test.js`
Expected: PASS

## タスク 7: 回帰確認をまとめて実行する

**Files:**
- Test: `test/shellgeiScorer.test.js`
- Test: `test/simpleJudge.test.js`
- Test: `test/runtimePlanner.test.js`
- Test: `test/openaiEngine.test.js`
- Test: `test/selector.test.js`
- Test: `test/solveFlow.test.js`
- Test: `test/formatResult.test.js`
- Test: `test/logWriter.test.js`
- Test: `test/cliOptions.test.js`

- [ ] **Step 1: 関連テストをまとめて実行する**
Run: `npm test -- test/shellgeiScorer.test.js test/simpleJudge.test.js test/runtimePlanner.test.js test/openaiEngine.test.js test/selector.test.js test/solveFlow.test.js test/formatResult.test.js test/logWriter.test.js test/cliOptions.test.js`
Expected: PASS

- [ ] **Step 2: 失敗があれば最小修正して再実行する**

```js
// Fix only the mismatched scorer/selector/log shapes uncovered by tests.
```

- [ ] **Step 3: 代表ケースを手動確認する**
Run: `npm test -- test/solveFlow.test.js`
Expected: PASS with selected candidate carrying rubric score, notes, penalties, and selector reason

- [ ] **Step 4: 作業内容を README / docs と照合する**

```md
- score mode 名が `README.md`, `docs/shellgei_llm_rubric.md`, CLI help で一致している
- shellgei score breakdown 名が `types`, formatter, logs で一致している
```

- [ ] **Step 5: コミットする**

```bash
git add plan/2026-06-13-shellgei-quality-loop-plan.md
git commit -m "docs: add shellgei quality loop implementation plan"
```
