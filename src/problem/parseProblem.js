function buildPlainTextProblem(problemInput) {
  return {
    raw: problemInput,
    problemText: problemInput,
    metadata: {
      format: "plain-text"
    }
  };
}

function trimTrailingNewlines(value) {
  return value.replace(/\n+$/u, "");
}

export function parseProblemInput(problemInput) {
  const structuredMatch = problemInput.match(
    /^expected_output:\s*\n([\s\S]*?)\n---\n([\s\S]+)$/u
  );

  if (!structuredMatch) {
    return buildPlainTextProblem(problemInput);
  }

  const expectedOutput = trimTrailingNewlines(structuredMatch[1]);
  const problemText = structuredMatch[2].trim();

  if (!expectedOutput || !problemText) {
    return buildPlainTextProblem(problemInput);
  }

  return {
    raw: problemInput,
    problemText,
    expectedOutput,
    metadata: {
      format: "plain-text+expected-output"
    }
  };
}
