# ShellGei Score Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pass` したワンライナー群に対してシェル芸らしさのスコアを追加計算し、そのスコアを最終選択に使えるようにし、最終出力では `pass` 候補の `command` と `score` を一覧表示できるようにする。

**Architecture:** `judge` は引き続き正答性の門番として扱い、並列実行完了後に `pass` 候補だけへ別プロセスで `shellgei score` を付与する。`selector` は `pass/fail` 判定を壊さず、`best-score-wins` 系の比較でこの新スコアを主信号に使い、同点時のみ既存の安定性や実行時間で比較する。

**Tech Stack:** Node.js, 既存 `src/core/*`, `src/judge/*`, `src/formatter/*`, `src/logs/*`, Vitest

---

## 前提と方針

- `SimpleJudge` の役割は維持し、`pass/fail` と基礎的な正答性スコアを返す責務に留める
- 新しい `shellgei score` は `pass` 済み候補だけに対して計算する
- 初期版の評価軸は `shortness`, `simplicity`, `speed` を最小集合とし、あとで拡張しやすい shape にする
- `first-pass-wins` は早期停止ポリシーとして残すが、完了済みの `pass` 候補が複数ある場合に最終選択で `shellgei score` を使えるよう、選択ロジックは候補集合ベースに寄せる
- 最終出力の `pass` 一覧は `command` と `score` のみを出し、`output` は一覧に含めない

## ファイル構成

**Create:**

- `src/core/shellgeiScorer.js`
- `test/shellgeiScorer.test.js`

**Modify:**

- `src/core/solve.js`
- `src/core/selector.js`
- `src/core/types.js`
- `src/formatter/formatResult.js`
- `src/logs/writer.js`
- `test/solveFlow.test.js`
- `test/selector.test.js`
- `test/formatResult.test.js`

## タスク 1: ShellGei score の型と計算責務を追加する

**Files:**

- Create: `src/core/shellgeiScorer.js`
- Modify: `src/core/types.js`
- Test: `test/shellgeiScorer.test.js`

- [ ] **Step 1: 先に scorer の期待 shape をテストで固定する**

```js
import { describe, expect, it } from "vitest";
import { scoreShellgeiCandidate } from "../src/core/shellgeiScorer.js";

describe("scoreShellgeiCandidate", () => {
  it("scores only passed candidates", () => {
    const result = scoreShellgeiCandidate({
      command: "awk -F, '{s+=$3} END{print s}' sample.csv",
      finalCheck: { passed: true },
      attempts: [{ durationMs: 12 }]
    });

    expect(result).toEqual({
      value: expect.any(Number),
      breakdown: {
        shortness: expect.any(Number),
        simplicity: expect.any(Number),
        speed: expect.any(Number)
      }
    });
  });

  it("returns null for non-passing candidates", () => {
    expect(scoreShellgeiCandidate({
      command: "printf 'x\\n'",
      finalCheck: { passed: false },
      attempts: []
    })).toBeNull();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- test/shellgeiScorer.test.js`
Expected: FAIL with `Cannot find module '../src/core/shellgeiScorer.js'`

- [ ] **Step 3: scorer を最小実装する**

```js
function commandTokenCount(command) {
  return command.trim().split(/\s+/).filter(Boolean).length;
}

function totalDurationMs(attempts) {
  return (attempts ?? []).reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0);
}

export function scoreShellgeiCandidate(candidate) {
  if (!candidate.finalCheck?.passed) {
    return null;
  }

  const command = candidate.command ?? "";
  const length = command.length;
  const tokens = commandTokenCount(command);
  const durationMs = totalDurationMs(candidate.attempts);

  const breakdown = {
    shortness: Math.max(0, 50 - Math.min(50, length)),
    simplicity: Math.max(0, 30 - Math.max(0, (tokens - 1) * 3)),
    speed: Math.max(0, 20 - Math.min(20, Math.floor(durationMs / 25)))
  };

  return {
    value: Object.values(breakdown).reduce((sum, score) => sum + score, 0),
    breakdown
  };
}
```

- [ ] **Step 4: 型定義へ新スコア shape を追加する**

```js
/**
 * @typedef {Object} ShellgeiScore
 * @property {number} value
 * @property {{shortness: number, simplicity: number, speed: number}} breakdown
 */
```

- [ ] **Step 5: テストを再実行して通過を確認する**

Run: `npm test -- test/shellgeiScorer.test.js`
Expected: PASS

## タスク 2: pass 候補へ shellgei score を付与して solve 結果へ載せる

**Files:**

- Modify: `src/core/solve.js`
- Modify: `src/core/types.js`
- Modify: `src/logs/writer.js`
- Test: `test/solveFlow.test.js`

- [ ] **Step 1: solve の結果 shape をテストで先に固定する**

```js
expect(result.candidates[0].shellgeiScore).toEqual({
  value: expect.any(Number),
  breakdown: {
    shortness: expect.any(Number),
    simplicity: expect.any(Number),
    speed: expect.any(Number)
  }
});
```

- [ ] **Step 2: ログにも新スコアが残ることをテストで固定する**

```js
const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
expect(logContent.candidates[0].shellgeiScore).toEqual(result.candidates[0].shellgeiScore);
```

- [ ] **Step 3: `finalizeSolve()` で pass 候補だけ再採点する**

```js
import { scoreShellgeiCandidate } from "./shellgeiScorer.js";

const scoredCandidates = execution.candidates.map((candidate) => ({
  ...candidate,
  shellgeiScore: scoreShellgeiCandidate(candidate)
}));

const selection = selectSolveOutcome(scoredCandidates, session.selectorName);
```

- [ ] **Step 4: 型とログ出力に `shellgeiScore` を通す**

```js
/**
 * @property {import("./shellgeiScorer.js").ShellgeiScore | null} [shellgeiScore]
 */
```

- [ ] **Step 5: 変更した solve 系テストを実行する**

Run: `npm test -- test/solveFlow.test.js`
Expected: PASS

## タスク 3: selector が shellgei score を最終選択に使うようにする

**Files:**

- Modify: `src/core/selector.js`
- Test: `test/selector.test.js`

- [ ] **Step 1: shellgei score 優先の順位づけをテストで定義する**

```js
it("prefers the passing candidate with the higher shellgei score", () => {
  const result = selectSolveOutcome(
    [
      {
        candidateId: "worker-1",
        command: "awk -F, '{s+=$3} END{print s}' sample.csv",
        shellgeiScore: { value: 82, breakdown: { shortness: 38, simplicity: 24, speed: 20 } },
        attempts: [{ durationMs: 15, stdout: "42\\n" }],
        output: "42",
        finalCheck: { passed: true, iterations: 1, engine: "mock", reason: "passed", score: { value: 100 } }
      },
      {
        candidateId: "worker-2",
        command: "cat sample.csv | awk -F, '{s+=$3} END{print s}'",
        shellgeiScore: { value: 67, breakdown: { shortness: 27, simplicity: 20, speed: 20 } },
        attempts: [{ durationMs: 15, stdout: "42\\n" }],
        output: "42",
        finalCheck: { passed: true, iterations: 1, engine: "mock", reason: "passed", score: { value: 100 } }
      }
    ],
    "best-score-wins"
  );

  expect(result.selectedCandidate?.candidateId).toBe("worker-1");
  expect(result.reason).toContain("shellgei score");
});
```

- [ ] **Step 2: 同点時に既存指標へフォールバックするテストを追加する**

```js
expect(result.reason).toContain("stdout consistency");
```

- [ ] **Step 3: 比較関数を `shellgeiScore -> judgeScore -> stdoutConsistency -> outputConsensus -> duration` の順へ更新する**

```js
const shellgeiScore = candidate.shellgeiScore?.value ?? -1;

if (leftScore.shellgeiScore !== rightScore.shellgeiScore) {
  return rightScore.shellgeiScore - leftScore.shellgeiScore;
}
```

- [ ] **Step 4: selector の返却 metrics に shellgei score を追加する**

```js
return {
  totalScore: shellgeiScore + judgeScore + stdoutConsistency + outputConsensus,
  shellgeiScore,
  judgeScore,
  stdoutConsistency,
  outputConsensus,
  totalDurationMs,
  iterationCount,
  commandLength,
  explanationLength
};
```

- [ ] **Step 5: selector テストを実行して通過を確認する**

Run: `npm test -- test/selector.test.js`
Expected: PASS

## タスク 4: 最終表示で pass 候補の command と score を全件表示する

**Files:**

- Modify: `src/formatter/formatResult.js`
- Modify: `src/core/types.js`
- Test: `test/formatResult.test.js`

- [ ] **Step 1: 出力仕様の期待値を先にテストへ追加する**

```js
expect(output).toContain("PASSING COMMANDS:");
expect(output).toContain("worker-1 | score: 82 | command: awk -F, '{s+=$3} END{print s}' sample.csv");
expect(output).toContain("worker-2 | score: 67 | command: cat sample.csv | awk -F, '{s+=$3} END{print s}'");
expect(output).not.toContain("OUTPUT:");
```

- [ ] **Step 2: formatter で pass 候補だけ抽出して一覧を組み立てる**

```js
const passingLines = (result.candidates ?? [])
  .filter((candidate) => candidate.finalCheck?.passed)
  .map((candidate) => {
    const score = candidate.shellgeiScore?.value ?? candidate.finalCheck?.score?.value ?? 0;
    return `${candidate.candidateId} | score: ${score} | command: ${candidate.command}`;
  });
```

- [ ] **Step 3: 一覧では `output` を出さず、採用候補の通常表示だけに残すかを明示する**

```js
return [
  "COMMAND:",
  result.command || "(none)",
  "",
  "EXPLANATION:",
  result.explanation,
  "",
  "PASSING COMMANDS:",
  ...(passingLines.length ? passingLines : ["(none)"])
].join("\\n");
```

- [ ] **Step 4: score breakdown 表示を shellgei score 前提へ拡張する**

```js
`selected-shellgei-score: ${result.selector?.metrics?.shellgeiScore ?? 0}`,
`shellgei-breakdown: shortness=${selectedShellgei?.breakdown.shortness ?? 0}, simplicity=${selectedShellgei?.breakdown.simplicity ?? 0}, speed=${selectedShellgei?.breakdown.speed ?? 0}`,
```

- [ ] **Step 5: formatter テストを実行して通過を確認する**

Run: `npm test -- test/formatResult.test.js`
Expected: PASS

## タスク 5: 回帰テストと文面の整合を取り、選択理由を説明可能にする

**Files:**

- Modify: `test/solveFlow.test.js`
- Modify: `test/selector.test.js`
- Modify: `test/formatResult.test.js`

- [ ] **Step 1: `first-pass-wins` でも複数 pass が揃った場合の表示を固定する**

```js
expect(result.candidates.filter((candidate) => candidate.finalCheck.passed)).toHaveLength(2);
expect(result.selector.selectedCandidateId).toBe("worker-1");
```

- [ ] **Step 2: 選択理由が `judge score` ではなく `shellgei score` を説明するケースを固定する**

```js
expect(result.selector.reason).toContain("shellgei score");
```

- [ ] **Step 3: 主要テストをまとめて実行する**

Run: `npm test -- test/shellgeiScorer.test.js test/selector.test.js test/solveFlow.test.js test/formatResult.test.js`
Expected: PASS

- [ ] **Step 4: 必要なら結果文面を微調整する**

```js
// selector reason 例
"Selected worker-1 as the best passing candidate; it won on shellgei score (82 > 67)."
```

- [ ] **Step 5: 変更範囲を最終確認する**

Run: `npm test`
Expected: PASS

## 補足メモ

- 初期版の `simplicity` は厳密な AST 解析ではなく、まずは token 数や無駄なパイプ数のような軽量 heuristic で始める
- `shellgei score` の重みは最初から固定値でよく、運用しながら `docs/` か `plan/` で見直せるよう score breakdown をログへ残す
- 将来的に `uniqueness` や `tool elegance` のような軸を増やす場合も、`shellgeiScorer.js` を差し替えるだけで済む境界を保つ
