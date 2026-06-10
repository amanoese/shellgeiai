export function parseProblemInput(problemInput) {
  return {
    raw: problemInput,
    problemText: problemInput,
    metadata: {
      format: "plain-text"
    }
  };
}
