# Planner Knowledge Selection and Worker Tool Calling Design

## Goal

Knowledge retrieval currently enriches every Worker task before command generation. This makes minor command and option knowledge available to Workers, but it does not influence the main Planner when it chooses exploration variants and suggested tools. It also injects hints into every Worker prompt even when the Worker does not need them.

This change gives the Planner a small, diverse set of retrieved command candidates before it creates Worker variants. Workers receive no knowledge text initially. A Worker may instead call a read-only `search_knowledge` Tool once during each attempt when it needs additional command, option, or ShellGei pattern information.

## CLI Semantics

`--knowledge` accepts these values:

| Value | Planner retrieval | Worker Tool Calling |
| --- | --- | --- |
| `off` | disabled | disabled |
| `planner` | enabled | disabled |
| `worker` | disabled | enabled |
| `all` | enabled | enabled |
| `on` | alias normalized to `all` | alias normalized to `all` |

The existing behavior that injects knowledge hints into every Worker prompt is removed. Logs and result formatting store the normalized value, so `on` appears as `all` after option parsing.

When `worker`, `all`, or `on` is selected, solve initialization checks the selected command-generation Engine's capabilities. If `toolCalling` is not explicitly supported, solve stops before planning or Worker execution with an actionable error recommending a Tool Calling capable Engine or `--knowledge planner/off`. `planner` remains usable with a command-generation Engine that does not support Tool Calling.

## Architecture

Tool Calling orchestration belongs to the Worker layer, not to an individual provider. Provider adapters translate their native response shapes to and from a shared turn format, while a generic `ToolRegistry` owns Tool definitions, validation, dispatch, and execution.

```text
SolveSession
  ├─ KnowledgeRetriever
  │    ├─ retrieveForPlanner(problem, expectedOutput)
  │    └─ search(query)
  ├─ Planner
  │    └─ plannerKnowledgeHints -> variants and toolSuggestions
  └─ Worker
       └─ WorkerToolLoop
            ├─ Engine.generateTurn(...)
            ├─ ToolRegistry.execute(toolCall)
            └─ Engine.generateTurn(toolResult) -> command
```

The shared Engine contract exposes a capability and a turn result:

```js
engine.capabilities = { toolCalling: true };

await engine.generateTurn({ context, messages, tools });

// One of:
{ type: "command", command, explanation }
{ type: "tool_calls", calls }
```

The command-only `generateCommand()` contract remains available. The Worker uses it for `off` and `planner`; it uses `generateTurn()` only for modes that enable Worker Tool Calling. A Tool Calling turn must contain exactly one Tool call. If a provider returns multiple calls in the same turn, the orchestration rejects the complete turn without executing any call.

The first native implementation is `OpenAIEngine`. It converts the shared Tool definitions and turn history to the OpenAI Responses API representation, then converts provider `function_call` output back to the common form. OpenAI-specific call IDs and `function_call_output` encoding remain inside the adapter.

`CodexCliEngine` and `CursorCliEngine` initially declare `toolCalling: false`. Their existing command-only paths continue to work for `off` and `planner`. Tests use a deterministic fake Engine to exercise the shared Tool Loop.

## Planner Retrieval

For `planner` and `all`, the solve session initializes and validates the configured dataset, vector cache, model, and dataset fingerprint before planning. It retrieves up to five hints using the problem text and expected output.

Planner retrieval favors breadth:

- at most five results;
- at most one result per command;
- deterministic similarity ordering and tie behavior;
- the existing vector cache and query embedding path;
- no requirement that the Planner select only retrieved commands.

The hints are stored as `session.plannerKnowledgeHints` before `createExecutionPlan()` calls the Planner provider. The Planner prompt renders bounded JSON-quoted fields (`command`, `option`, truncated `text`, and `source`) and labels them as untrusted reference data. It explicitly asks the Planner to use relevant candidates when choosing `toolSuggestions`, `toolBias`, and exploration variants, while allowing safer or better commands not present in retrieval results.

The prompt version is incremented because the Planner input contract changes. Planner logs retain the exact resulting prompt through the existing planner metadata.

## Generic ToolRegistry

`ToolRegistry` supports registration and execution independently of provider APIs. A Tool definition contains:

```js
{
  name,
  description,
  inputSchema,
  execute
}
```

`inputSchema` is a Zod schema used by the registry for runtime validation. The registry converts it to a common JSON Schema representation when exposing serializable definitions to Engines; execution functions are never exposed to Engines. Provider adapters only translate that common JSON Schema to their native Tool declaration shape.

The registry rejects duplicate names, unknown Tools, and arguments that do not satisfy the Tool schema.

The first registered Tool is `search_knowledge`:

```json
{
  "name": "search_knowledge",
  "description": "Search command, option, and ShellGei pattern knowledge relevant to the current attempt.",
  "arguments": {
    "query": "non-empty string"
  }
}
```

The caller cannot choose an unbounded result count. The Tool always returns at most five records. Results use the same bounded, JSON-safe fields as Planner hints. The Tool is read-only and cannot invoke the Runner or execute shell commands.

The query is trimmed, must be non-empty, and is limited to 500 characters. Each result text is limited to 300 characters. These bounds apply before logging or returning data to an Engine.

## Worker Tool Loop

For `worker` and `all`, Worker prompts no longer contain precomputed `knowledgeHints`. They contain only the registered Tool definitions through the shared Engine interface.

Each Worker attempt receives a fresh Tool budget of one call:

1. The Worker Engine returns either a final command or one common-form Tool call.
2. The orchestration layer validates the call and executes it through `ToolRegistry`.
3. The Tool result is appended to the shared turn history.
4. The Engine receives one continuation turn and must return a final command.
5. A second Tool request is rejected with a clear limit error.

If a provider returns zero calls or multiple calls in a `tool_calls` turn, no Tool is executed and the attempt fails with a provider-contract error.

An unknown Tool, invalid arguments, or retrieval failure consumes the one-call budget. The registry returns a structured error without a stack trace, and the Engine receives one final opportunity to produce a command without another Tool call. If it requests another Tool or fails to produce a command, the existing attempt failure and retry behavior applies. A later Worker attempt starts with a new one-call budget.

The existing safety policy remains unchanged: the Tool only searches text records, and every generated command still passes through command policy, Runner, and Judge.

## Logging and Types

Each attempt may record Tool activity:

```json
{
  "toolCalls": [
    {
      "name": "search_knowledge",
      "arguments": { "query": "CSV 3列目 数値 合計" },
      "status": "completed",
      "resultCount": 5,
      "recordIds": ["...", "..."]
    }
  ]
}
```

Logs do not duplicate complete knowledge text. They retain Tool name, validated arguments, completion/error status, result count, and record IDs for reproducibility. Error entries contain a stable public message rather than provider or filesystem stack traces.

Session and attempt documentation types are extended for normalized knowledge mode, Planner hints, Engine Tool Calling capability, shared turn results, and Tool call summaries.

## Error Handling

- Invalid `--knowledge` values list `off`, `planner`, `worker`, `all`, and `on`.
- `on` is normalized before session creation.
- Tool Calling capability is checked during solve initialization for modes that require it.
- Dataset, model, path, and fingerprint mismatches retain the existing rebuild-required errors.
- Planner retrieval failure stops planning because the requested Planner knowledge mode cannot be fulfilled.
- Worker Tool failures are returned as bounded Tool errors and then follow the normal attempt/retry lifecycle.
- Provider response parsing rejects malformed or mixed command/Tool-call results.

## Testing

Tests cover:

- CLI parsing and normalization for all five accepted values;
- mode-specific dataset initialization and capability validation;
- Planner retrieval occurring before Planner prompt construction;
- Planner prompt bounds, quoting, provenance, and command-selection instructions;
- removal of unconditional Worker hint injection;
- ToolRegistry registration, schema validation, unknown Tool handling, and sanitized errors;
- query/result bounds and rejection of zero or multiple calls in one Tool turn;
- direct Worker command generation without a Tool call;
- one `search_knowledge` call followed by command generation;
- rejection of a second call in the same attempt and budget reset on retry;
- OpenAI Responses API Tool definition, call, result, and continuation translation;
- unsupported Engine fail-fast behavior for `worker` and `all` but not `planner`;
- deterministic Tool logs without full record text;
- preservation of dataset/model/fingerprint cache validation;
- end-to-end mode routing with fake Planner, Engine, retriever, and Runner dependencies.

No paid API call or real model download is required by the automated tests.

## Compatibility and Scope

This change intentionally replaces the old `--knowledge worker` initial-injection behavior. Dataset formats, vector metadata, model selection, `knowledge prepare/build/search/man`, and Runner safety policies remain compatible.

Only `search_knowledge` is registered in this iteration. The registry and shared turn contract allow future read-only Tools, but this design does not add them or add native Tool Calling support to non-OpenAI command Engines.
