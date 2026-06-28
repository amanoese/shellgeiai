# src Directory Hierarchy Design

## Goal

Reduce the number of top-level directories under `src/` first, then make the solve flow easier to follow.

The previous readability refactor made individual files clearer, but `src/` still exposes many top-level responsibility directories. This makes the codebase look wider than it is. The next refactor should group related modules into a smaller set of top-level areas while preserving behavior.

## Non-Goals

- Do not change CLI behavior, defaults, help text, or parse result shapes.
- Do not change solve/check/replay result formats.
- Do not change planner, runner, judge, selector, safety, or logging behavior.
- Do not introduce new abstractions beyond directory grouping and import updates.
- Do not remove compatibility re-exports that existing tests or external entry points depend on.
- Do not rename public package entry points such as `src/cli.js`.

## Current Problem

After the latest refactor, the main responsibilities are clearer at file level, but `src/` still has too many peer directories:

```text
src/
  cli/
  core/
  worker/
  runner/
  safety/
  judge/
  engines/
  planner/
  logs/
  formatter/
  problem/
  util/
```

This layout forces a reader to know the architecture before knowing where to start. Some directories are also too small to justify top-level weight, such as `problem/`, `util/`, `judge/`, and `safety/`.

## Recommended Shape

Use a small set of top-level groups:

```text
src/
  cli/
  solve/
  execution/
  providers/
  io/
  shared/
```

Responsibilities:

- `cli/`: command wiring and CLI option parsing.
- `solve/`: solve/check/replay application flow and worker orchestration.
- `execution/`: command execution, safety policy, and judging.
- `providers/`: model/provider-facing code for command generation and planning.
- `io/`: problem parsing, saved logs, and user-facing formatting.
- `shared/`: small cross-cutting utilities.

Keep these root compatibility files:

```text
src/cli.js
src/cliOptions.js
```

## Target Layout

```text
src/
  cli.js
  cliOptions.js
  cli/
    index.js
    parseCliOptions.js
    commands/
    options/

  solve/
    solve.js
    check.js
    replay.js
    session/
      solveSession.js
      sessionPhases.js
      progress.js
      types.js
    orchestration/
      orchestrator.js
      executionControl.js
      executionSummary.js
    worker/
      executeWorkerTask.js
      attemptRunner.js
      attemptFactory.js
      stopReason.js
      taskExecutor.js
      taskQueue.js
    planning/
      planner.js
    selection/
      selector.js
    scoring/
      shellgeiScorer.js

  execution/
    runner/
      Runner.js
      limits.js
      localRunner.js
      dockerRunner.js
    safety/
      checker.js
      commandPolicy.js
      policyLoader.js
      sandboxPolicy.js
    judge/
      Judge.js
      simpleJudge.js

  providers/
    engines/
      Engine.js
      codexCliEngine.js
      cursorCliEngine.js
      mockEngine.js
      openaiEngine.js
    planner/
      llmPlanner.js
      plannerPrompt.js
      plannerSchema.js

  io/
    problem/
      parseProblem.js
    logs/
      writer.js
      catalog.js
    formatter/
      formatResult.js
      logs.js
      progressReporter.js

  shared/
    exec.js
    fs.js
```

## Migration Order

### Phase 1: Reduce Top-Level Directories

Move small infrastructure groups first:

- `runner/` -> `execution/runner/`
- `safety/` -> `execution/safety/`
- `judge/` -> `execution/judge/`
- `engines/` -> `providers/engines/`
- `planner/` -> `providers/planner/`
- `problem/` -> `io/problem/`
- `logs/` -> `io/logs/`
- `formatter/` -> `io/formatter/`
- `util/` -> `shared/`

This phase should mostly be mechanical import updates. It should not change module APIs.

### Phase 2: Make Solve Flow Local

Move solve-specific code under `solve/`:

- `core/solve.js` -> `solve/solve.js`
- `core/check.js` -> `solve/check.js`
- `core/replay.js` -> `solve/replay.js`
- `core/solveSession.js` -> `solve/session/solveSession.js`
- `core/sessionPhases.js` -> `solve/session/sessionPhases.js`
- `core/progress.js` -> `solve/session/progress.js`
- `core/types.js` -> `solve/session/types.js`
- `core/orchestrator.js` -> `solve/orchestration/orchestrator.js`
- `core/executionControl.js` -> `solve/orchestration/executionControl.js`
- `core/executionSummary.js` -> `solve/orchestration/executionSummary.js`
- `worker/*` -> `solve/worker/*`
- `core/planner.js` -> `solve/planning/planner.js`
- `core/selector.js` -> `solve/selection/selector.js`
- `core/shellgeiScorer.js` -> `solve/scoring/shellgeiScorer.js`

After this phase, a reader can follow solve behavior from `solve/solve.js` into `session/`, `orchestration/`, `worker/`, `selection/`, and `scoring/`.

## Compatibility Policy

Prefer direct import updates for internal modules. Add compatibility wrappers only for:

- existing package entry files
- files already used as compatibility shims
- paths that tests intentionally assert remain stable

Compatibility wrappers should be one-line re-exports where possible.
Do not keep old internal top-level directories only for compatibility. For example, move the existing `worker/taskExecutor.js` compatibility wrapper to `solve/worker/taskExecutor.js` and update internal tests/imports to the new location.

## Testing Strategy

Run focused tests after each move group:

```bash
npm test -- test/cliOptions.test.js test/solveCommand.test.js
npm test -- test/orchestrator.test.js test/solveFlow.test.js test/checkReplay.test.js
npm test -- test/runner.test.js test/dockerRunner.unit.test.js test/safety.test.js test/simpleJudge.test.js
npm test -- test/logCatalog.test.js test/logWriter.test.js test/logsShow.test.js test/formatResult.test.js
```

Run the full suite before committing:

```bash
npm test
```

## Acceptance Criteria

- Top-level directories under `src/` are reduced to the recommended groups plus root compatibility files.
- The solve flow is readable under `src/solve/`.
- `src/cli.js` and `src/cliOptions.js` continue to work.
- Existing tests pass.
- Documentation reflects the new hierarchy.
- No user-facing behavior changes are introduced.
