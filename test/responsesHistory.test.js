import { describe, expect, it } from "vitest";
import { createResponsesContinuation, resumeResponsesInput } from "../src/providers/llm/responsesHistory.js";

const call = (id) => ({ type: "function_call", id: `fc-${id}`, call_id: id,
  name: "search_knowledge", arguments: '{"query":"printf"}', status: "completed" });
const initialInput = () => [
  { role: "system", content: [{ type: "input_text", text: "Generate a command." }] },
  { role: "user", content: [{ type: "input_text", text: "print ok" }] }
];

describe("Responses history helpers", () => {
  it("clones the complete input and provider output without filtering fields", () => {
    const input = initialInput();
    const output = [
      { type: "reasoning", id: "rs-1", summary: [], encrypted_content: "secret" },
      call("call-1"), { type: "future_output", id: "future-1", data: { nested: ["value"] } }
    ];
    const continuation = createResponsesContinuation(input, output);
    expect(continuation).toEqual({ input: [...input, ...output] });
    input[0].content[0].text = "changed";
    output[0].encrypted_content = "changed";
    output[2].data.nested.push("changed");
    expect(continuation.input[0].content[0].text).toBe("Generate a command.");
    expect(continuation.input[2].encrypted_content).toBe("secret");
    expect(continuation.input[4].data.nested).toEqual(["value"]);
  });

  it("clones frozen continuation and appends results in the caller's order", () => {
    const continuation = createResponsesContinuation(initialInput(), [call("one"), call("two")]);
    const before = structuredClone(continuation);
    Object.freeze(continuation.input);
    const results = [{ callId: "two", result: "plain string" }, { callId: "one", result: { ok: true } }];
    const input = resumeResponsesInput(continuation, results);
    expect(input).toEqual([...before.input,
      { type: "function_call_output", call_id: "two", output: '"plain string"' },
      { type: "function_call_output", call_id: "one", output: '{"ok":true}' }
    ]);
    input[0].content[0].text = "changed";
    expect(continuation).toEqual(before);
    expect(results[1].result).toEqual({ ok: true });
  });

  it("matches only pending calls when a history contains earlier results", () => {
    const continuation = { input: [...initialInput(), call("one"),
      { type: "function_call_output", call_id: "one", output: "{}" },
      { type: "reasoning", encrypted_content: "encrypted" }, call("two")] };
    expect(resumeResponsesInput(continuation, [{ callId: "two", result: null }]).at(-1))
      .toEqual({ type: "function_call_output", call_id: "two", output: "null" });
    expect(() => resumeResponsesInput(continuation, [{ callId: "one", result: {} }]))
      .toThrow("The API engine received invalid Tool results.");
  });

  it.each([
    { input: {} }, { input: [null] }, { input: [{ unexpected: true }] },
    { input: [...initialInput(), call("one"), call("one")] },
    { input: [...initialInput(), { ...call("one"), name: " " }] },
    { input: [...initialInput(), { ...call("one"), arguments: "[]" }] },
    { input: [...initialInput(), { ...call("one"), status: "in_progress" }] },
    { input: [...initialInput(), call("one"),
      { type: "function_call_output", call_id: "other", output: "{}" }] },
    { input: [...initialInput(), call("one"),
      { type: "function_call_output", call_id: "one", output: {} }, call("two")] },
    { input: [...initialInput(), call("one"),
      { type: "function_call_output", call_id: "one", output: "{}" },
      { type: "function_call_output", call_id: "one", output: "{}" }, call("two")] }
  ])("rejects malformed replay history %j", (continuation) => {
    expect(() => resumeResponsesInput(continuation, [{ callId: "one", result: {} }]))
      .toThrow(/continuation/);
  });

  it.each([
    { label: "undefined", result: undefined },
    { label: "BigInt", result: 1n },
    { label: "circular", result: (() => { const value = {}; value.self = value; return value; })() },
    { label: "throwing toJSON", result: { toJSON() { throw new Error("private data"); } } }
  ])("rejects $label serialization with a safe error and leaves input untouched", ({ result }) => {
    const continuation = createResponsesContinuation(initialInput(), [call("one")]);
    const before = structuredClone(continuation);
    expect(() => resumeResponsesInput(continuation, [{ callId: "one", result }]))
      .toThrow("The API engine could not serialize a Tool result.");
    expect(continuation).toEqual(before);
  });
});
