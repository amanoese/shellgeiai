# src Directory Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce top-level directories under `src/` first, then make the solve flow readable under `src/solve/`, without changing behavior.

**Architecture:** Move existing modules into six top-level groups: `cli`, `solve`, `execution`, `providers`, `io`, and `shared`. Each task adds a focused import-path test for the group it moves, verifies that test fails before the move, then moves files and updates imports until focused and related behavior tests pass.

**Tech Stack:** Node.js ESM, Vitest, existing JavaScript modules, no new dependencies.

---

## File Structure

Keep:

- `src/cli.js`
- `src/cliOptions.js`
- `src/cli/**`

Create and move into:

- `src/execution/runner/**`
- `src/execution/safety/**`
- `src/execution/judge/**`
- `src/providers/engines/**`
- `src/providers/planner/**`
- `src/io/problem/**`
- `src/io/logs/**`
- `src/io/formatter/**`
- `src/shared/**`
- `src/solve/**`

Remove old top-level directories after their files are moved:

- `src/core/`
- `src/worker/`
- `src/runner/`
- `src/safety/`
- `src/judge/`
- `src/engines/`
- `src/planner/`
- `src/logs/`
- `src/formatter/`
- `src/problem/`
- `src/util/`

Use `rtk git mv` for moves so rename history is retained.

## Task 1: Move Execution Infrastructure

**Files:**

- Move: `src/runner/*` -> `src/execution/runner/`
- Move: `src/safety/*` -> `src/execution/safety/`
- Move: `src/judge/*` -> `src/execution/judge/`
- Modify imports in: `src/**`, `test/**`
- Test: `test/packagePublish.test.js`

- [ ] **Step 1: Add failing import test for execution paths**

Add this test to `test/packagePublish.test.js`:

```js
it("exposes execution modules from the grouped src hierarchy", async () => {
  const modules = [
    "../src/execution/runner/localRunner.js",
    "../src/execution/runner/dockerRunner.js",
    "../src/execution/runner/limits.js",
    "../src/execution/safety/checker.js",
    "../src/execution/safety/policyLoader.js",
    "../src/execution/judge/simpleJudge.js"
  ];

  await Promise.all(modules.map((modulePath) => import(modulePath)));
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
rtk npm test -- test/packagePublish.test.js
```

Expected: FAIL with missing module errors under `src/execution/`.

- [ ] **Step 3: Move execution files**

Run:

```bash
rtk mkdir -p src/execution/runner src/execution/safety src/execution/judge
rtk git mv src/runner/Runner.js src/execution/runner/Runner.js
rtk git mv src/runner/limits.js src/execution/runner/limits.js
rtk git mv src/runner/localRunner.js src/execution/runner/localRunner.js
rtk git mv src/runner/dockerRunner.js src/execution/runner/dockerRunner.js
rtk git mv src/safety/checker.js src/execution/safety/checker.js
rtk git mv src/safety/commandPolicy.js src/execution/safety/commandPolicy.js
rtk git mv src/safety/policyLoader.js src/execution/safety/policyLoader.js
rtk git mv src/safety/sandboxPolicy.js src/execution/safety/sandboxPolicy.js
rtk git mv src/judge/Judge.js src/execution/judge/Judge.js
rtk git mv src/judge/simpleJudge.js src/execution/judge/simpleJudge.js
```

- [ ] **Step 4: Update imports**

Update old paths to new paths. Examples:

```js
import { createDefaultRunnerLimits } from "../execution/runner/limits.js";
import { isSafeCommand } from "../execution/safety/checker.js";
import { SimpleJudge } from "../execution/judge/simpleJudge.js";
```

Also update tests that import from `src/runner`, `src/safety`, or `src/judge`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk npm test -- test/packagePublish.test.js test/runner.test.js test/dockerRunner.unit.test.js test/safety.test.js test/simpleJudge.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add src test
rtk git commit -m "refactor: group execution infrastructure"
```

Expected: commit succeeds.

## Task 2: Move Provider Modules

**Files:**

- Move: `src/engines/*` -> `src/providers/engines/`
- Move: `src/planner/*` -> `src/providers/planner/`
- Modify imports in: `src/**`, `test/**`
- Test: `test/packagePublish.test.js`

- [ ] **Step 1: Add failing import test for provider paths**

Add this test to `test/packagePublish.test.js`:

```js
it("exposes provider modules from the grouped src hierarchy", async () => {
  const modules = [
    "../src/providers/engines/openaiEngine.js",
    "../src/providers/engines/mockEngine.js",
    "../src/providers/engines/codexCliEngine.js",
    "../src/providers/planner/llmPlanner.js",
    "../src/providers/planner/plannerSchema.js"
  ];

  await Promise.all(modules.map((modulePath) => import(modulePath)));
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
rtk npm test -- test/packagePublish.test.js
```

Expected: FAIL with missing module errors under `src/providers/`.

- [ ] **Step 3: Move provider files**

Run:

```bash
rtk mkdir -p src/providers/engines src/providers/planner
rtk git mv src/engines/Engine.js src/providers/engines/Engine.js
rtk git mv src/engines/codexCliEngine.js src/providers/engines/codexCliEngine.js
rtk git mv src/engines/cursorCliEngine.js src/providers/engines/cursorCliEngine.js
rtk git mv src/engines/mockEngine.js src/providers/engines/mockEngine.js
rtk git mv src/engines/openaiEngine.js src/providers/engines/openaiEngine.js
rtk git mv src/planner/llmPlanner.js src/providers/planner/llmPlanner.js
rtk git mv src/planner/plannerPrompt.js src/providers/planner/plannerPrompt.js
rtk git mv src/planner/plannerSchema.js src/providers/planner/plannerSchema.js
```

- [ ] **Step 4: Update imports**

Update old paths to new paths. Examples:

```js
import { OpenAIEngine } from "../providers/engines/openaiEngine.js";
import { llmPlanner } from "../../providers/planner/llmPlanner.js";
import { normalizePlannerResult } from "../../providers/planner/plannerSchema.js";
```

Also update tests that import from `src/engines` or `src/planner`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk npm test -- test/packagePublish.test.js test/openaiEngine.test.js test/llmPlanner.test.js test/runtimePlanner.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add src test
rtk git commit -m "refactor: group provider modules"
```

Expected: commit succeeds.

## Task 3: Move IO and Shared Modules

**Files:**

- Move: `src/problem/*` -> `src/io/problem/`
- Move: `src/logs/*` -> `src/io/logs/`
- Move: `src/formatter/*` -> `src/io/formatter/`
- Move: `src/util/*` -> `src/shared/`
- Modify imports in: `src/**`, `test/**`
- Test: `test/packagePublish.test.js`

- [ ] **Step 1: Add failing import test for IO and shared paths**

Add this test to `test/packagePublish.test.js`:

```js
it("exposes io and shared modules from the grouped src hierarchy", async () => {
  const modules = [
    "../src/io/problem/parseProblem.js",
    "../src/io/logs/writer.js",
    "../src/io/logs/catalog.js",
    "../src/io/formatter/formatResult.js",
    "../src/io/formatter/progressReporter.js",
    "../src/shared/fs.js",
    "../src/shared/exec.js"
  ];

  await Promise.all(modules.map((modulePath) => import(modulePath)));
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
rtk npm test -- test/packagePublish.test.js
```

Expected: FAIL with missing module errors under `src/io/` or `src/shared/`.

- [ ] **Step 3: Move IO and shared files**

Run:

```bash
rtk mkdir -p src/io/problem src/io/logs src/io/formatter src/shared
rtk git mv src/problem/parseProblem.js src/io/problem/parseProblem.js
rtk git mv src/logs/writer.js src/io/logs/writer.js
rtk git mv src/logs/catalog.js src/io/logs/catalog.js
rtk git mv src/formatter/formatResult.js src/io/formatter/formatResult.js
rtk git mv src/formatter/logs.js src/io/formatter/logs.js
rtk git mv src/formatter/progressReporter.js src/io/formatter/progressReporter.js
rtk git mv src/util/exec.js src/shared/exec.js
rtk git mv src/util/fs.js src/shared/fs.js
```

- [ ] **Step 4: Update imports**

Update old paths to new paths. Examples:

```js
import { parseProblemInput } from "../io/problem/parseProblem.js";
import { writeSolveSessionLog } from "../io/logs/writer.js";
import { formatResult } from "../../io/formatter/formatResult.js";
import { resolveRequestedWorkdir } from "../shared/fs.js";
import { commandExists } from "../../shared/exec.js";
```

Also update tests that import from `src/problem`, `src/logs`, `src/formatter`, or `src/util`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk npm test -- test/packagePublish.test.js test/problemParser.test.js test/logCatalog.test.js test/logWriter.test.js test/logsShow.test.js test/formatResult.test.js test/progressReporter.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add src test
rtk git commit -m "refactor: group io and shared modules"
```

Expected: commit succeeds.

## Task 4: Move Solve Session and Application Entry Modules

**Files:**

- Move: `src/core/solve.js` -> `src/solve/solve.js`
- Move: `src/core/check.js` -> `src/solve/check.js`
- Move: `src/core/replay.js` -> `src/solve/replay.js`
- Move: `src/core/runtime.js` -> `src/solve/runtime.js`
- Move: `src/core/solveSession.js` -> `src/solve/session/solveSession.js`
- Move: `src/core/sessionPhases.js` -> `src/solve/session/sessionPhases.js`
- Move: `src/core/progress.js` -> `src/solve/session/progress.js`
- Move: `src/core/types.js` -> `src/solve/session/types.js`
- Modify imports in: `src/**`, `test/**`
- Test: `test/packagePublish.test.js`

- [ ] **Step 1: Add failing import test for solve entry and session paths**

Add this test to `test/packagePublish.test.js`:

```js
it("exposes solve entry and session modules from the grouped src hierarchy", async () => {
  const modules = [
    "../src/solve/solve.js",
    "../src/solve/check.js",
    "../src/solve/replay.js",
    "../src/solve/runtime.js",
    "../src/solve/session/solveSession.js",
    "../src/solve/session/progress.js",
    "../src/solve/session/types.js"
  ];

  await Promise.all(modules.map((modulePath) => import(modulePath)));
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
rtk npm test -- test/packagePublish.test.js
```

Expected: FAIL with missing module errors under `src/solve/`.

- [ ] **Step 3: Move solve entry and session files**

Run:

```bash
rtk mkdir -p src/solve/session
rtk git mv src/core/solve.js src/solve/solve.js
rtk git mv src/core/check.js src/solve/check.js
rtk git mv src/core/replay.js src/solve/replay.js
rtk git mv src/core/runtime.js src/solve/runtime.js
rtk git mv src/core/solveSession.js src/solve/session/solveSession.js
rtk git mv src/core/sessionPhases.js src/solve/session/sessionPhases.js
rtk git mv src/core/progress.js src/solve/session/progress.js
rtk git mv src/core/types.js src/solve/session/types.js
```

- [ ] **Step 4: Update imports**

Update old paths to new paths. Examples:

```js
import { solveProblem } from "../../solve/solve.js";
import { checkCommand } from "../../solve/check.js";
import { replaySolveLog } from "../../solve/replay.js";
import { createSolveRuntime } from "../../solve/runtime.js";
import { reportSessionPhase } from "./session/progress.js";
```

Also update tests that import from these old `src/core` files.

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk npm test -- test/packagePublish.test.js test/solveSession.test.js test/solveFlow.test.js test/checkReplay.test.js test/solveCommand.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add src test
rtk git commit -m "refactor: move solve session modules"
```

Expected: commit succeeds.

## Task 5: Move Solve Orchestration, Worker, Planning, Selection, and Scoring

**Files:**

- Move: `src/core/orchestrator.js` -> `src/solve/orchestration/orchestrator.js`
- Move: `src/core/executionControl.js` -> `src/solve/orchestration/executionControl.js`
- Move: `src/core/executionSummary.js` -> `src/solve/orchestration/executionSummary.js`
- Move: `src/worker/*` -> `src/solve/worker/`
- Move: `src/core/planner.js` -> `src/solve/planning/planner.js`
- Move: `src/core/selector.js` -> `src/solve/selection/selector.js`
- Move: `src/core/shellgeiScorer.js` -> `src/solve/scoring/shellgeiScorer.js`
- Modify imports in: `src/**`, `test/**`
- Test: `test/packagePublish.test.js`

- [ ] **Step 1: Add failing import test for solve flow paths**

Add this test to `test/packagePublish.test.js`:

```js
it("exposes solve flow modules from the grouped src hierarchy", async () => {
  const modules = [
    "../src/solve/orchestration/orchestrator.js",
    "../src/solve/orchestration/executionControl.js",
    "../src/solve/orchestration/executionSummary.js",
    "../src/solve/worker/executeWorkerTask.js",
    "../src/solve/worker/attemptRunner.js",
    "../src/solve/worker/taskQueue.js",
    "../src/solve/planning/planner.js",
    "../src/solve/selection/selector.js",
    "../src/solve/scoring/shellgeiScorer.js"
  ];

  await Promise.all(modules.map((modulePath) => import(modulePath)));
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
rtk npm test -- test/packagePublish.test.js
```

Expected: FAIL with missing module errors under `src/solve/orchestration`, `src/solve/worker`, `src/solve/planning`, `src/solve/selection`, or `src/solve/scoring`.

- [ ] **Step 3: Move solve flow files**

Run:

```bash
rtk mkdir -p src/solve/orchestration src/solve/worker src/solve/planning src/solve/selection src/solve/scoring
rtk git mv src/core/orchestrator.js src/solve/orchestration/orchestrator.js
rtk git mv src/core/executionControl.js src/solve/orchestration/executionControl.js
rtk git mv src/core/executionSummary.js src/solve/orchestration/executionSummary.js
rtk git mv src/worker/attemptFactory.js src/solve/worker/attemptFactory.js
rtk git mv src/worker/attemptRunner.js src/solve/worker/attemptRunner.js
rtk git mv src/worker/executeWorkerTask.js src/solve/worker/executeWorkerTask.js
rtk git mv src/worker/stopReason.js src/solve/worker/stopReason.js
rtk git mv src/worker/taskExecutor.js src/solve/worker/taskExecutor.js
rtk git mv src/worker/taskQueue.js src/solve/worker/taskQueue.js
rtk git mv src/core/planner.js src/solve/planning/planner.js
rtk git mv src/core/selector.js src/solve/selection/selector.js
rtk git mv src/core/shellgeiScorer.js src/solve/scoring/shellgeiScorer.js
```

- [ ] **Step 4: Update imports**

Update old paths to new paths. Examples:

```js
import { runSolveOrchestrator } from "./orchestration/orchestrator.js";
import { createExecutionPlan } from "../planning/planner.js";
import { createWorkerTaskQueue } from "../worker/taskQueue.js";
import { reportSolveProgress } from "../session/progress.js";
import { isSafeCommand } from "../../execution/safety/checker.js";
```

For tests, import from the new paths:

```js
import { createExecutionSummary } from "../src/solve/orchestration/executionSummary.js";
import { createExecutionControl } from "../src/solve/orchestration/executionControl.js";
import { runWorkerAttempt } from "../src/solve/worker/attemptRunner.js";
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk npm test -- test/packagePublish.test.js test/orchestrator.test.js test/solveFlow.test.js test/selector.test.js test/shellgeiScorer.test.js test/runtimePlanner.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add src test
rtk git commit -m "refactor: move solve flow modules"
```

Expected: commit succeeds.

## Task 6: Update Documentation and Verify Final Hierarchy

**Files:**

- Modify: `docs/ideal-architecture.md`
- Modify: `docs/ideal-cli-flow.md`
- Modify: `AGENTS.md` if it lists old current components

- [ ] **Step 1: Update current layout docs**

Update current-state sections to mention:

```text
src/
  cli/
  solve/
  execution/
  providers/
  io/
  shared/
```

Also update old path references such as:

```text
src/core/orchestrator.js
src/worker/executeWorkerTask.js
src/runner/dockerRunner.js
src/safety/checker.js
src/logs/writer.js
src/formatter/formatResult.js
```

to their new paths.

- [ ] **Step 2: Verify old top-level directories are gone**

Run:

```bash
rtk find src -maxdepth 2 -type d
```

Expected output should not include top-level `core`, `worker`, `runner`, `safety`, `judge`, `engines`, `planner`, `logs`, `formatter`, `problem`, or `util`.

- [ ] **Step 3: Run full tests**

Run:

```bash
rtk npm test
```

Expected: PASS.

- [ ] **Step 4: Check diff cleanliness**

Run:

```bash
rtk git diff --stat
rtk git diff --check
```

Expected: only planned path moves, import updates, tests, and docs; no whitespace errors.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add src test docs AGENTS.md
rtk git commit -m "docs: update src hierarchy references"
```

Expected: commit succeeds.

## Self-Review

- Spec coverage: top-level reduction is covered by Tasks 1-3. Solve flow locality is covered by Tasks 4-5. Documentation and final verification are covered by Task 6.
- Placeholder scan: no placeholders remain.
- Type and path consistency: target path names match the design spec: `solve`, `execution`, `providers`, `io`, and `shared`. Root compatibility files remain `src/cli.js` and `src/cliOptions.js`.
