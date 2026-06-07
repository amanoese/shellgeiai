function hasOnlyWarnings(stderr) {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return true;
  }

  return /^warning[:\s]/i.test(trimmed);
}

export class SimpleJudge {
  async judge(input) {
    if (input.timedOut) {
      return {
        passed: false,
        reason: "Command timed out."
      };
    }

    if (input.exitCode !== 0) {
      return {
        passed: false,
        reason: `Command exited with code ${input.exitCode}.`
      };
    }

    if (!hasOnlyWarnings(input.stderr)) {
      return {
        passed: false,
        reason: "stderr was not empty."
      };
    }

    if (!input.stdout.trim()) {
      return {
        passed: false,
        reason: "stdout was empty."
      };
    }

    if (input.expectedOutput !== undefined && input.stdout.trim() !== input.expectedOutput.trim()) {
      return {
        passed: false,
        reason: "Output did not match expected output."
      };
    }

    return {
      passed: true,
      reason: input.expectedOutput !== undefined ? "Output matched expected output." : "Basic checks passed."
    };
  }
}
