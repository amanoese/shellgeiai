const CONTINUATION_ERROR = "The API engine received an invalid continuation.";
const TOOL_RESULTS_ERROR = "The API engine received invalid Tool results.";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneHistory(input) {
  try {
    return structuredClone(input);
  } catch {
    throw new Error(CONTINUATION_ERROR);
  }
}

export function parseResponsesToolCalls(output) {
  const ids = new Set();
  return output.filter((item) => item?.type === "function_call").map((item) => {
    if (item.status != null && item.status !== "completed") {
      throw new Error("The API engine returned a non-completed Tool call.");
    }
    if (!isNonEmptyString(item.call_id)) {
      throw new Error("The API engine returned a Tool call without a call ID.");
    }
    if (ids.has(item.call_id)) {
      throw new Error("The API engine returned duplicate Tool call IDs.");
    }
    ids.add(item.call_id);
    if (!isNonEmptyString(item.name)) {
      throw new Error("The API engine returned a Tool call without a name.");
    }
    let args;
    try {
      if (typeof item.arguments !== "string") throw new Error();
      args = JSON.parse(item.arguments);
    } catch {
      throw new Error("The API engine returned invalid Tool call arguments.");
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error("The API engine returned invalid Tool call arguments.");
    }
    return { id: item.call_id, name: item.name, arguments: args };
  });
}

/** Preserve every provider item, including encrypted reasoning, in a private copy. */
export function createResponsesContinuation(input, output) {
  return { input: cloneHistory([...input, ...output]) };
}

/** Resume from local history; provider-side stored response IDs are never needed. */
export function resumeResponsesInput(continuation, toolResults) {
  if (!continuation || typeof continuation !== "object" || Array.isArray(continuation) ||
      !Array.isArray(continuation.input) || continuation.input.length === 0) {
    throw new Error(CONTINUATION_ERROR);
  }
  const input = cloneHistory(continuation.input);
  const pending = new Set();
  try {
    parseResponsesToolCalls(input);
    for (const item of input) {
      if (!item || typeof item !== "object" || Array.isArray(item) ||
          !(isNonEmptyString(item.type) || (isNonEmptyString(item.role) && item.content != null))) {
        throw new Error();
      }
      if (item.type === "function_call") {
        pending.add(item.call_id);
      } else if (item.type === "function_call_output") {
        if (!isNonEmptyString(item.call_id) || typeof item.output !== "string" ||
            !pending.delete(item.call_id)) {
          throw new Error();
        }
      }
    }
    if (pending.size === 0) throw new Error();
  } catch {
    throw new Error(CONTINUATION_ERROR);
  }
  if (!Array.isArray(toolResults) || toolResults.length !== pending.size) {
    throw new Error(TOOL_RESULTS_ERROR);
  }
  for (const entry of toolResults) {
    if (!entry || !isNonEmptyString(entry.callId) || !pending.delete(entry.callId)) {
      throw new Error(TOOL_RESULTS_ERROR);
    }
  }
  for (const { callId, result } of toolResults) {
    let output;
    try {
      output = JSON.stringify(result);
    } catch {
      throw new Error("The API engine could not serialize a Tool result.");
    }
    if (typeof output !== "string") {
      throw new Error("The API engine could not serialize a Tool result.");
    }
    input.push({ type: "function_call_output", call_id: callId, output });
  }
  return input;
}
