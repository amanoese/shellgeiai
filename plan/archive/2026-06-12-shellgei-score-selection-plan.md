# ShellGei Score Implementation Plan

**Status:** Archived, completed in substance, and later expanded by the 2026-06-13 quality-loop work.

**Archive note:** This plan’s original goal was to introduce a separate `shellgei score` for passed candidates, use it in `best-score-wins`, and show passing commands with scores in the final output. That work is now present in the codebase, but the implementation evolved beyond this draft: the current system uses rubric-based scoring (`conciseness`, `shellness`, `ingenuity`, `readability`, `robustness`, `artistry`) instead of the draft’s earlier `shortness`, `simplicity`, `speed` shape.

**Superseded by:** [2026-06-13-shellgei-quality-loop-plan.md](/home/amanoese/repos/shellgeiai/plan/2026-06-13-shellgei-quality-loop-plan.md)

## Completion Check

- [x] `src/core/shellgeiScorer.js` exists and computes a dedicated shellgei score for passing candidates
- [x] `src/core/solve.js` attaches `shellgeiScore` to candidates after execution
- [x] `src/core/selector.js` uses `shellgeiScore` in `best-score-wins`
- [x] `src/formatter/formatResult.js` shows selected shellgei score and passing command summaries
- [x] `src/logs/writer.js` persists scored candidates in logs
- [x] Tests cover scorer, solve flow, selector behavior, formatter output, and logs
- [x] Follow-up work on 2026-06-13 expanded this into the current two-layer quality loop

## Archived Task Summary

### Task 1: Add ShellGei score calculation

- [x] Define a dedicated shellgei scoring unit separate from `judge`
- [x] Add scorer coverage in tests
- [x] Implement scorer logic for passed candidates
- [x] Wire score shape into shared types
- [x] Verify scorer tests pass

### Task 2: Attach shellgei score to solve results

- [x] Add `shellgeiScore` to solve result candidates
- [x] Persist scored candidates in solve logs
- [x] Re-score passed candidates during solve finalization
- [x] Propagate score shape through result/log types
- [x] Verify solve flow tests pass

### Task 3: Use shellgei score in final selection

- [x] Prioritize shellgei score in `best-score-wins`
- [x] Keep tie-break fallback behavior for stability metrics
- [x] Expose selector metrics including shellgei score
- [x] Verify selector tests pass

### Task 4: Show passing commands and scores in final output

- [x] List passing commands in formatted output
- [x] Show selected shellgei score in the final report
- [x] Preserve compact command-and-score output for comparison
- [x] Verify formatter tests pass

### Task 5: Regression coverage and wording alignment

- [x] Run the related test set
- [x] Keep output and logs aligned with selection behavior
- [x] Carry the work forward into the broader quality-loop plan

## Current Implementation Notes

- The original draft score shape was replaced by a richer rubric-based score.
- The original idea of “score only passed candidates, then select with `best-score-wins`” remains intact.
- This archived plan should be treated as historically completed, but not as the latest design source.
