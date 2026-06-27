# src Readability Refactor Design

## Goal

Improve the readability of `src/` without changing current user-facing behavior.

The current directory layout is already close to the intended architecture, but several files still mix orchestration, execution, data shaping, progress events, and CLI parsing. This refactor should make the existing flow easier to read before introducing larger architectural changes.

## Non-Goals

- Do not change CLI behavior or default options.
- Do not change solve/check/replay result formats.
- Do not replace the current planner, runner, judge, or selector behavior.
- Do not introduce a new type system or broad framework dependency.
- Do not move toward the full ideal architecture in one pass.

## Primary Problems

### Worker execution is too dense

`src/worker/taskExecutor.js` currently owns too much:

- the worker retry loop
- stop/deadline checks
- engine calls
- command safety checks
- runner execution
- judge execution
- attempt object construction
- candidate and worker summary construction
- progress reporting

This makes it hard to understand the worker flow without reading every detail.

### Orchestration mixes policy and aggregation

`src/core/orchestrator.js` should mostly answer: how many worker tasks run, when do they stop, and what execution summary comes back?

It currently also contains stop-control details and result aggregation details. Those are useful concepts, but they should be named separately.

### CLI option parsing is monolithic

`src/cliOptions.js` parses every command in one file. This makes each subcommand harder to change and test in isolation.

### Shared session setup is duplicated

`solve`, `check`, and `replay` each need similar setup for workdir, logs, runner limits, command policy, and sandbox policy. This can be factored later, after the solve worker path is clearer.

## Recommended Shape

### Worker layer

Split worker execution into smaller modules:

```text
src/worker/
  executeWorkerTask.js
  attemptRunner.js
  attemptFactory.js
  stopReason.js
  taskQueue.js
```

Responsibilities:

- `executeWorkerTask.js`: run the worker retry loop and return `{ attempts, candidate, workerSummary }`.
- `attemptRunner.js`: run one attempt from engine call through judge decision.
- `attemptFactory.js`: build attempt, candidate, and worker summary objects.
- `stopReason.js`: centralize stop and deadline reason checks.
- `taskQueue.js`: keep existing queue/concurrency helpers.

`executeWorkerTask.js` may still report progress initially, but attempt construction and stop checking should no longer be embedded in the same function.

### Core orchestration layer

Split orchestration support code:

```text
src/core/
  orchestrator.js
  executionControl.js
  executionSummary.js
```

Responsibilities:

- `orchestrator.js`: create the task queue, start worker loops, and return the execution summary.
- `executionControl.js`: own stop state, abort controllers, early-stop behavior, and deadline checks.
- `executionSummary.js`: convert worker results into attempts, candidates, worker summaries, stop reason, and counts.

This keeps `orchestrator.js` readable as the session-level execution story.

### CLI parsing layer

Split CLI parsing after the worker/orchestrator cleanup:

```text
src/cli/
  parseCliOptions.js
  options/
    shared.js
    solveOptions.js
    checkOptions.js
    replayOptions.js
    logsOptions.js
```

Keep `src/cliOptions.js` as a compatibility re-export during the migration if tests or callers import it directly.

### Shared command-session setup

After the previous steps, extract common setup used by `check` and `replay`, and only include `solve` pieces when the shared abstraction stays simple:

```text
src/core/commandSession.js
```

This should cover workdir, logs directory, policies, writable workdir, deadlines, and runner limits. It should not hide solve-specific planner or selector behavior.

## Migration Plan

1. Add focused tests around existing worker/orchestrator behavior if coverage is missing.
2. Extract worker stop/deadline checks into `src/worker/stopReason.js`.
3. Extract attempt/candidate/summary object construction into `src/worker/attemptFactory.js`.
4. Extract one-attempt execution into `src/worker/attemptRunner.js`.
5. Rename or replace `taskExecutor.js` with `executeWorkerTask.js`, keeping a compatibility re-export if needed.
6. Extract orchestration stop control into `src/core/executionControl.js`.
7. Extract execution summary shaping into `src/core/executionSummary.js`.
8. Split `src/cliOptions.js` by subcommand while preserving exported API.
9. Extract shared check/replay command-session setup only after duplication is easy to see.
10. Update architecture docs to describe the current shape.

Each step should keep tests passing before moving to the next step.

## Verification

Run the normal test suite after each substantial step:

```bash
npm test
```

For runner changes, also run focused tests:

```bash
npm test -- test/orchestrator.test.js test/solveFlow.test.js test/checkReplay.test.js
```

Docker integration tests are optional unless `DockerRunner` behavior changes:

```bash
npm run test:docker
```

## Acceptance Criteria

- `src/worker/taskExecutor.js` is removed or reduced to a compatibility wrapper.
- Worker retry logic, single-attempt execution, and attempt object creation can be read independently.
- `src/core/orchestrator.js` is mostly queue/concurrency/session execution flow.
- `src/cliOptions.js` no longer contains all subcommand parsers inline, or remains only as a re-export.
- Existing tests pass.
- User-facing CLI behavior is unchanged.
