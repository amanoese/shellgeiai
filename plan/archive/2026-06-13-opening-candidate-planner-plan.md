# Opening Candidate Planner Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** planner が問題文に応じた初手候補の型を 3-5 本作り、各 worker に 1 本ずつ割り当てることで、初手探索のバリエーションとシェル芸品質を上げる。

**Architecture:** `planner` に `openingCandidates` と `assignedOpeningCandidate` を導入し、worker ごとに「最初にどの型のコマンドから始めるか」を明示的に配る。各 engine prompt は 1 手目だけその assigned candidate を強く優先し、2 手目以降は既存の retry 方針へ戻る。結果ログには、どの worker がどの初手案を担当したかを残して後から比較できるようにする。

**Tech Stack:** Node.js, Vitest, 既存 `src/core/*`, `src/engines/*`, `src/logs/*`, `test/*`

---

## 方針

- 既存の `strategyProfile` は残し、`assignedOpeningCandidate` を追加で載せる
- planner は「問題を完全理解して最適解を当てる」のではなく、「初手探索を分散させる」責務に留める
- opening candidate は実コマンド文字列ではなく「型」と「避けるべき癖」を持つ構造にする
- 1 手目だけ強制力を強くし、2 手目以降は通常の retry に戻す
- `selector` や `judge` には今回は手を入れない
- `solve` とログで assigned metadata が残ることをテストで固定する

## 非目標

- planner 自身が最終コマンド文字列を生成すること
- 問題文の高度な意味解析器を追加すること
- 初手候補の quality score をこのタスクで計算すること
- `mock` engine の解法能力を上げること

## データ構造案

```js
/**
 * @typedef {Object} OpeningCandidate
 * @property {string} candidateId
 * @property {string} approach
 * @property {string[]} toolBias
 * @property {string} why
 * @property {string[]} avoid
 * @property {string} firstTryHint
 */
```

```js
/**
 * @typedef {Object} WorkerTask
 * @property {string} workerId
 * @property {string} strategy
 * @property {{name: string, focus: string, retryHint: string, rubricFocus: string[]}} strategyProfile
 * @property {OpeningCandidate} [assignedOpeningCandidate]
 * @property {number} maxAttempts
 */
```

```js
/**
 * @typedef {Object} ExecutionPlan
 * @property {"single" | "parallel"} mode
 * @property {number} parallelism
 * @property {OpeningCandidate[]} openingCandidates
 * @property {WorkerTask[]} workerTasks
 */
```

## 初手候補の最低ライン

問題文から最低でも次の型を候補化できるようにする。

- `awk-record-pass`
- `filter-pipeline`
- `shell-loop-or-seq`
- `normalization-first`
- 問題によっては `external-utility` (`factor`, `sort`, `uniq`, `cut` など) を含める

素数のような問題では、少なくとも `awk` 一本足打法以外に `seq + factor`, `seq + shell loop`, `awk`, `xargs` 系のどれかが混ざる形を目標にする。

### Task 1: opening candidate の型と planner 契約を先に固定する

**Files:**

- Modify: `src/core/types.js`
- Test: `test/runtimePlanner.test.js`

- [ ] **Step 1: opening candidate を含む plan shape の失敗テストを書く**

```js
it("creates opening candidates and assigns one to each worker", () => {
  const plan = createExecutionPlan({
    mode: "parallel",
    parallelism: 4,
    maxIterations: 2,
    problem: {
      raw: "1から100までの素数を出力してください",
      problemText: "1から100までの素数を出力してください"
    }
  });

  expect(plan.openingCandidates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        candidateId: expect.any(String),
        approach: expect.any(String),
        toolBias: expect.any(Array),
        why: expect.any(String),
        avoid: expect.any(Array),
        firstTryHint: expect.any(String)
      })
    ])
  );

  expect(plan.workerTasks[0].assignedOpeningCandidate).toEqual(
    expect.objectContaining({
      candidateId: expect.any(String),
      approach: expect.any(String)
    })
  );
});
```

- [ ] **Step 2: テストを実行して現状との差分を確認する**

Run:

```bash
npm test -- test/runtimePlanner.test.js
```

Expected: FAIL with missing `openingCandidates` or missing `assignedOpeningCandidate`

- [ ] **Step 3: 型定義に opening candidate shape を追加する**

```js
/**
 * @typedef {Object} OpeningCandidate
 * @property {string} candidateId
 * @property {string} approach
 * @property {string[]} toolBias
 * @property {string} why
 * @property {string[]} avoid
 * @property {string} firstTryHint
 */
```

```js
/**
 * @typedef {Object} WorkerTask
 * @property {OpeningCandidate} [assignedOpeningCandidate]
 */
```

```js
/**
 * @typedef {Object} ExecutionPlan
 * @property {OpeningCandidate[]} openingCandidates
 */
```

- [ ] **Step 4: planner test を再実行して shape failure が型由来ではなく実装由来であることを確認する**

Run:

```bash
npm test -- test/runtimePlanner.test.js
```

Expected: FAIL only because planner has not populated the new fields yet

- [ ] **Step 5: コミットする**

```bash
git add src/core/types.js test/runtimePlanner.test.js
git commit -m "test: define opening candidate planner contract"
```

### Task 2: planner が問題依存の opening candidates を生成して worker に配る

**Files:**

- Modify: `src/core/planner.js`
- Test: `test/runtimePlanner.test.js`

- [ ] **Step 1: 素数問題で awk 以外の案も混ざることを失敗テストで固定する**

```js
it("creates diversified opening candidates for prime-number problems", () => {
  const plan = createExecutionPlan({
    mode: "parallel",
    parallelism: 5,
    maxIterations: 2,
    problem: {
      raw: "1から100までの素数を出力してください",
      problemText: "1から100までの素数を出力してください"
    }
  });

  const approaches = plan.openingCandidates.map((candidate) => candidate.approach);

  expect(approaches).toContain("awk-record-pass");
  expect(approaches).toContain("shell-loop-or-seq");
  expect(approaches.some((name) => name === "external-utility" || name === "filter-pipeline")).toBe(true);
  expect(new Set(plan.workerTasks.map((task) => task.assignedOpeningCandidate?.candidateId)).size).toBeGreaterThan(1);
});
```

- [ ] **Step 2: テストを実行して現状の planner が初手候補を持たないことを確認する**

Run:

```bash
npm test -- test/runtimePlanner.test.js
```

Expected: FAIL because `plan.openingCandidates` is undefined or undiversified

- [ ] **Step 3: planner に opening candidate generator を最小実装する**

```js
function buildOpeningCandidates(problemText) {
  const text = (problemText ?? "").toLowerCase();
  const candidates = [
    {
      candidateId: "open-awk",
      approach: "awk-record-pass",
      toolBias: ["awk"],
      why: "Good default for numeric filtering and one-pass transforms.",
      avoid: ["multiple passes", "temporary files"],
      firstTryHint: "Try a single awk-driven pass before mixing more tools."
    },
    {
      candidateId: "open-pipeline",
      approach: "filter-pipeline",
      toolBias: ["grep", "sed", "tr", "paste"],
      why: "Useful when a stream-oriented decomposition is clearer than a monolith.",
      avoid: ["embedded scripts"],
      firstTryHint: "Prefer a natural stdin/stdout pipeline with small standard tools."
    },
    {
      candidateId: "open-loop",
      approach: "shell-loop-or-seq",
      toolBias: ["seq", "sh", "xargs"],
      why: "Useful when the problem is fundamentally enumeration-driven.",
      avoid: ["awk-only contortions"],
      firstTryHint: "Start from sequence generation and prune rather than forcing one giant expression."
    }
  ];

  if (/prime|素数/.test(problemText ?? "")) {
    candidates.push({
      candidateId: "open-factor",
      approach: "external-utility",
      toolBias: ["seq", "factor", "awk"],
      why: "Prime problems often benefit from a factor-based predicate instead of handwritten divisibility logic.",
      avoid: ["awk-only contortions", "double parsing"],
      firstTryHint: "Consider seq + factor style approaches before writing custom primality logic."
    });
  }

  return candidates;
}
```

```js
const openingCandidates = buildOpeningCandidates(session.problem?.problemText ?? "");

workerTasks: Array.from({ length: workerCount }, (_, index) => ({
  workerId: `worker-${index + 1}`,
  strategy: strategyCatalog[index % strategyCatalog.length].strategy,
  strategyProfile: buildStrategyProfile(index),
  assignedOpeningCandidate: openingCandidates[index % openingCandidates.length],
  maxAttempts: session.maxIterations
}))
```

- [ ] **Step 4: planner テストを再実行して worker ごとに初手候補が配られることを確認する**

Run:

```bash
npm test -- test/runtimePlanner.test.js
```

Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add src/core/planner.js test/runtimePlanner.test.js
git commit -m "feat: assign opening candidates from planner"
```

### Task 3: engine prompt に assigned opening candidate を注入し、1 手目だけ強く優先させる

**Files:**

- Modify: `src/engines/openaiEngine.js`
- Modify: `src/engines/codexCliEngine.js`
- Test: `test/openaiEngine.test.js`

- [ ] **Step 1: prompt が assigned opening candidate を含む失敗テストを書く**

```js
it("includes assigned opening candidate guidance in the first prompt", () => {
  const { buildUserPrompt } = __testUtils();

  const prompt = buildUserPrompt({
    problem: "1から100までの素数を出力してください",
    attempts: [],
    workdir: "/tmp/workdir",
    workerTask: {
      workerId: "worker-3",
      strategy: "default",
      strategyProfile: {
        name: "balanced-search",
        focus: "Start with direct safe one-liner.",
        retryHint: "Remove redundant stages before changing whole approach.",
        rubricFocus: ["conciseness", "shellness", "robustness"]
      },
      assignedOpeningCandidate: {
        candidateId: "open-factor",
        approach: "external-utility",
        toolBias: ["seq", "factor", "awk"],
        why: "Prime problems often benefit from factor-based filtering.",
        avoid: ["awk-only contortions"],
        firstTryHint: "Consider seq + factor before custom primality logic."
      },
      maxAttempts: 3
    }
  });

  expect(prompt).toContain("Assigned opening candidate:");
  expect(prompt).toContain("external-utility");
  expect(prompt).toContain("First attempt priority:");
  expect(prompt).toContain("Consider seq + factor before custom primality logic.");
});
```

- [ ] **Step 2: テストを実行して現状 prompt に初手候補情報がないことを確認する**

Run:

```bash
npm test -- test/openaiEngine.test.js
```

Expected: FAIL because prompt does not contain `Assigned opening candidate:`

- [ ] **Step 3: OpenAI prompt に 1 手目用 guidance を追加する**

```js
const isFirstAttempt = context.attempts.length === 0;

workerTask?.assignedOpeningCandidate
  ? `Assigned opening candidate: ${workerTask.assignedOpeningCandidate.approach}`
  : "",
workerTask?.assignedOpeningCandidate?.toolBias?.length
  ? `Preferred tool bias: ${workerTask.assignedOpeningCandidate.toolBias.join(", ")}`
  : "",
workerTask?.assignedOpeningCandidate?.why
  ? `Opening rationale: ${workerTask.assignedOpeningCandidate.why}`
  : "",
workerTask?.assignedOpeningCandidate?.avoid?.length
  ? `Avoid in opening attempt: ${workerTask.assignedOpeningCandidate.avoid.join(", ")}`
  : "",
isFirstAttempt && workerTask?.assignedOpeningCandidate?.firstTryHint
  ? `First attempt priority: ${workerTask.assignedOpeningCandidate.firstTryHint}`
  : "",
isFirstAttempt
  ? "On the first attempt, stay close to the assigned opening candidate before broadening the search."
  : "You may broaden the search now that the assigned opening candidate has been tried."
```

- [ ] **Step 4: Codex CLI prompt にも同じ opening candidate guidance を追加する**

```js
workerTask?.assignedOpeningCandidate?.approach
  ? `Assigned opening candidate: ${workerTask.assignedOpeningCandidate.approach}`
  : ""
```

```js
context.attempts.length === 0 && workerTask?.assignedOpeningCandidate?.firstTryHint
  ? `First attempt priority: ${workerTask.assignedOpeningCandidate.firstTryHint}`
  : ""
```

- [ ] **Step 5: engine テストを再実行して通過を確認する**

Run:

```bash
npm test -- test/openaiEngine.test.js
```

Expected: PASS

- [ ] **Step 6: コミットする**

```bash
git add src/engines/openaiEngine.js src/engines/codexCliEngine.js test/openaiEngine.test.js
git commit -m "feat: inject planner opening candidates into engine prompts"
```

### Task 4: solve とログで assigned opening candidate を追跡できるようにする

**Files:**

- Modify: `src/core/solve.js`
- Modify: `src/logs/writer.js`
- Test: `test/solveFlow.test.js`
- Test: `test/logWriter.test.js`

- [ ] **Step 1: solve result と saved log に assigned opening candidate が残ることを失敗テストで固定する**

```js
expect(result.plan.workerTasks[0].assignedOpeningCandidate).toEqual(
  expect.objectContaining({
    candidateId: expect.any(String),
    approach: expect.any(String)
  })
);

const logContent = JSON.parse(await readFile(result.logPath, "utf8"));
expect(logContent.plan.workerTasks[0].assignedOpeningCandidate).toEqual(
  expect.objectContaining({
    candidateId: expect.any(String),
    approach: expect.any(String)
  })
);
```

- [ ] **Step 2: テストを実行して現状ログ shape に assigned opening candidate が残らない場合を確認する**

Run:

```bash
npm test -- test/solveFlow.test.js test/logWriter.test.js
```

Expected: FAIL if `plan.workerTasks[].assignedOpeningCandidate` is missing from result or log

- [ ] **Step 3: solve / log writer で assigned opening candidate をそのまま保存する**

```js
return {
  command: selectedCandidate?.command ?? "",
  // ...
  plan: session.plan
};
```

```js
plan: session.plan ?? null
```

Step note:
- ここでは追加の再構築や正規化をせず、planner が返した `assignedOpeningCandidate` をそのまま残す

- [ ] **Step 4: solve / log テストを再実行して通過を確認する**

Run:

```bash
npm test -- test/solveFlow.test.js test/logWriter.test.js
```

Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add src/core/solve.js src/logs/writer.js test/solveFlow.test.js test/logWriter.test.js
git commit -m "test: preserve assigned opening candidates in solve logs"
```

### Task 5: 回帰確認とドキュメント反映

**Files:**

- Modify: `README.md`
- Modify: `docs/ideal-cli-flow.md`
- Test: `test/runtimePlanner.test.js`
- Test: `test/openaiEngine.test.js`
- Test: `test/solveFlow.test.js`
- Test: `test/logWriter.test.js`

- [ ] **Step 1: README に初手候補 planner の役割を追記する**

```md
- planner は worker ごとに初手候補の型 (`opening candidate`) を配り、同じ問題でも探索の入り口を分散させる
```

- [ ] **Step 2: ideal flow に opening candidate 配布を追記する**

```md
- Planner は strategy 名だけでなく、worker ごとの opening candidate を作る
- worker は最初の 1 回だけ assigned opening candidate を強く優先して探索を始める
```

- [ ] **Step 3: 関連テストをまとめて実行する**

Run:

```bash
npm test -- test/runtimePlanner.test.js test/openaiEngine.test.js test/solveFlow.test.js test/logWriter.test.js
```

Expected: PASS

- [ ] **Step 4: 代表ケースを手動確認する**

Run:

```bash
npm run dev -- solve "1から100までの素数を出力してください" --progress off --parallelism 5
```

Expected:
- 各 worker の初手が同じ `awk` 方向に潰れにくくなる
- ログ上で worker ごとの `assignedOpeningCandidate` が追える

- [ ] **Step 5: 最終コミットする**

```bash
git add README.md docs/ideal-cli-flow.md src/core/planner.js src/core/types.js src/engines/openaiEngine.js src/engines/codexCliEngine.js src/core/solve.js src/logs/writer.js test/runtimePlanner.test.js test/openaiEngine.test.js test/solveFlow.test.js test/logWriter.test.js
git commit -m "feat: diversify worker openings with planner-assigned candidates"
```

## 自己レビュー

- spec coverage:
  - planner 主導の初手候補生成: Task 2
  - worker への割り当て: Task 2
  - 1 手目だけ強く優先する prompt: Task 3
  - ログで追跡可能にする: Task 4
  - docs 反映: Task 5
- placeholder scan:
  - `TODO` / `TBD` なし
  - 各 task に具体的な test / command / code snippet を記載
- type consistency:
  - `OpeningCandidate`
  - `assignedOpeningCandidate`
  - `openingCandidates`
  - `firstTryHint`
  の命名で全タスクを統一
