import { describe, expect, it } from "vitest";
import { parseProblemInput } from "../src/io/problem/parseProblem.js";

describe("parseProblemInput", () => {
  it("keeps plain text input compatible with the previous behavior", () => {
    expect(parseProblemInput("CSVの3列目の合計を出してください")).toEqual({
      raw: "CSVの3列目の合計を出してください",
      problemText: "CSVの3列目の合計を出してください",
      metadata: {
        format: "plain-text"
      }
    });
  });

  it("extracts expected output from a structured plain-text problem block", () => {
    expect(
      parseProblemInput(`expected_output:
15
---
CSVの3列目の合計を出してください`)
    ).toEqual({
      raw: `expected_output:
15
---
CSVの3列目の合計を出してください`,
      problemText: "CSVの3列目の合計を出してください",
      expectedOutput: "15",
      metadata: {
        format: "plain-text+expected-output"
      }
    });
  });

  it("keeps multiline expected output intact", () => {
    expect(
      parseProblemInput(`expected_output:
ok
done
---
2行のステータスを出力してください`)
    ).toEqual({
      raw: `expected_output:
ok
done
---
2行のステータスを出力してください`,
      problemText: "2行のステータスを出力してください",
      expectedOutput: "ok\ndone",
      metadata: {
        format: "plain-text+expected-output"
      }
    });
  });

  it("falls back to plain text when the structured block is incomplete", () => {
    const input = `expected_output:
ok
---
`;

    expect(parseProblemInput(input)).toEqual({
      raw: input,
      problemText: input,
      metadata: {
        format: "plain-text"
      }
    });
  });
});
