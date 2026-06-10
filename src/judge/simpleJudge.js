function hasOnlyWarnings(stderr) {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return true;
  }

  return /^warning[:\s]/i.test(trimmed);
}

function buildScoreBreakdown(input, { passedExpectedOutput, passed, stderrAllowed }) {
  return {
    correctness: passed ? 60 : 0,
    stdoutQuality: input.stdout.trim() ? 15 : 0,
    stderrQuality: stderrAllowed ? 10 : 0,
    expectedOutput: input.expectedOutput === undefined ? 15 : passedExpectedOutput ? 15 : 0
  };
}

function buildDecision(input, { passed, reason, passedExpectedOutput = false, stderrAllowed = false }) {
  const breakdown = buildScoreBreakdown(input, {
    passedExpectedOutput,
    passed,
    stderrAllowed
  });

  return {
    passed,
    reason,
    score: {
      value: Object.values(breakdown).reduce((sum, score) => sum + score, 0),
      breakdown
    }
  };
}

export class SimpleJudge {
  async judge(input) {
    if (input.timedOut) {
      return buildDecision(input, {
        passed: false,
        reason: "Command timed out."
      });
    }

    if (input.exitCode !== 0) {
      return buildDecision(input, {
        passed: false,
        reason: `Command exited with code ${input.exitCode}.`
      });
    }

    const stderrAllowed = hasOnlyWarnings(input.stderr);
    if (!stderrAllowed) {
      return buildDecision(input, {
        passed: false,
        reason: "stderr was not empty."
      });
    }

    if (!input.stdout.trim()) {
      return buildDecision(input, {
        passed: false,
        reason: "stdout was empty.",
        stderrAllowed
      });
    }

    const passedExpectedOutput =
      input.expectedOutput === undefined || input.stdout.trim() === input.expectedOutput.trim();
    if (!passedExpectedOutput) {
      return buildDecision(input, {
        passed: false,
        reason: "Output did not match expected output.",
        stderrAllowed
      });
    }

    return buildDecision(input, {
      passed: true,
      reason: input.expectedOutput !== undefined ? "Output matched expected output." : "Basic checks passed.",
      passedExpectedOutput,
      stderrAllowed
    });
  }
}
