import path from "node:path";

export class MockEngine {
  name = "mock";

  async generateCommand(context) {
    const lowerProblem = context.problem.toLowerCase();
    const failedBefore = context.attempts.length > 0;
    const samplePath = path.join(context.workdir, "sample.csv");

    if (
      lowerProblem.includes("3列目") ||
      lowerProblem.includes("third column") ||
      lowerProblem.includes("sum-third-column")
    ) {
      return {
        command: failedBefore
          ? `awk -F, '{s+=$3} END{print s}' "${samplePath}"`
          : "awk -F, '{s+=$3} END{print s}' sample.csv",
        explanation: "CSVをカンマ区切りで読み込み、3列目を合計して最後に表示します。"
      };
    }

    return {
      command: "printf 'mock-engine could not infer a better command\\n'",
      explanation: "MVPのmockEngineは既知の例題を優先して処理します。"
    };
  }
}
