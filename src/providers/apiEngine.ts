import type { Engine, SolveContext, GenerateTurnInput, EngineTurn, LlmConfig } from "../types.js";
import type { LlmClient, LlmClientFactory, LlmConfigOptions } from "./llm.js";
import type { Response, ResponseCreateParamsNonStreaming, FunctionTool } from "openai/resources/responses/responses";
export interface ApiEngineOptions extends LlmConfigOptions { config?: LlmConfig; client?: LlmClient; clientFactory?: LlmClientFactory; fetchImpl?: typeof globalThis.fetch }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
import { resolveLlmConfig, createLlmClient, requestLlmResponse, createResponsesContinuation, parseResponsesToolCalls, resumeResponsesInput } from "./llm.js";

function buildSystemPrompt() {
    return [
        "You generate a single shell command for a shell-gei problem.",
        "Return JSON only.",
        'Use shape {"command":"...","explanation":"..."}.',
        "Do not include markdown fences.",
        "Do not execute commands.",
        "Prefer a shell-gei style one-liner.",
        "Favor natural stdin/stdout flow with standard Unix tools.",
        "Avoid redundant cat, duplicated passes, temporary files, or embedded scripts.",
        "Prefer a single safe one-liner that works in the provided workdir."
    ].join(" ");
}

const STRICT_TOOL_SCHEMA_ERROR = "The API engine received a Tool schema incompatible with strict mode.";

function buildUserPrompt(context: SolveContext) {
    const workerTask = context.workerTask ?? null;
    const attemptSummary = context.attempts.length > 0
        ? JSON.stringify(context.attempts.map((attempt) => ({
            command: attempt.command,
            reason: attempt.failureReason ?? "",
            passed: attempt.passed ?? false,
            durationMs: attempt.durationMs ?? null
        })))
        : "[]";
    return [
        `Problem: ${context.problem}`,
        `Working directory: ${context.workdir}`,
        context.workerId ? `Worker: ${context.workerId}` : "",
        context.strategy ? `Strategy: ${context.strategy}` : "",
        workerTask?.strategyProfile?.name ? `Worker role: ${workerTask.strategyProfile.name}` : "",
        workerTask?.strategyProfile?.focus ? `Role focus: ${workerTask.strategyProfile.focus}` : "",
        workerTask?.strategyProfile?.retryHint
            ? `Retry hint: ${workerTask.strategyProfile.retryHint}`
            : "",
        workerTask?.strategyProfile?.rubricFocus?.length
            ? `Shellgei rubric focus: ${workerTask.strategyProfile.rubricFocus.join(", ")}`
            : "",
        workerTask?.assignedVariant?.label ? `Assigned variant: ${workerTask.assignedVariant.label}` : "",
        workerTask?.assignedVariant?.approach
            ? `Variant approach: ${workerTask.assignedVariant.approach}`
            : "",
        workerTask?.assignedVariant?.toolBias?.length
            ? `Preferred tool bias: ${workerTask.assignedVariant.toolBias.join(", ")}`
            : "",
        workerTask?.assignedVariant?.intent
            ? `Variant intent: ${workerTask.assignedVariant.intent}`
            : "",
        workerTask?.assignedVariant?.constraints?.length
            ? `Variant constraints: ${workerTask.assignedVariant.constraints.join(", ")}`
            : "",
        workerTask?.assignedVariant?.avoid?.length
            ? `Avoid while exploring: ${workerTask.assignedVariant.avoid.join(", ")}`
            : "",
        workerTask?.assignedVariant?.explorationHint
            ? `Exploration hint: ${workerTask.assignedVariant.explorationHint}`
            : "",
        workerTask?.assignedVariant?.toolSuggestions?.length
            ? `Variant tool suggestions: ${JSON.stringify(workerTask.assignedVariant.toolSuggestions)}`
            : "",
        workerTask?.assignedVariant
            ? "Use assigned variant as a soft exploration axis, not a rigid first step."
            : "",
        workerTask?.assignedVariant?.toolSuggestions?.length
            ? "Use suggestedTools as optional starting points, but choose any safer or better tools if needed."
            : "",
        `Retry budget: ${workerTask?.maxAttempts ?? 1}`,
        `Previous attempts: ${attemptSummary}`
    ]
        .filter(Boolean)
        .join("\n");
}

function stripCodeFence(raw: string) {
    return raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
}

function parseEngineResponse(raw: string) {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripCodeFence(raw));
    }
    catch {
        throw new Error("The API engine returned non-JSON response.");
    }
    if (!isRecord(parsed) || typeof parsed.command !== "string" || !parsed.command.trim()) {
        throw new Error("The API engine returned JSON response without command.");
    }
    return {
        command: parsed.command.trim(),
        explanation: typeof parsed.explanation === "string" && parsed.explanation.trim()
            ? parsed.explanation.trim()
            : "Generated by LLM API."
    };
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function reasoningOptions(model: string): Pick<ResponseCreateParamsNonStreaming, "include"> {
    return ["openai/gpt-6.1-sol", "gpt-6.1-sol"].includes(model)
        ? { include: ["reasoning.encrypted_content"] }
        : {};
}

function assertResponseOutput(response: Response) {
    if (response?.output !== undefined && !Array.isArray(response.output)) {
        throw new Error("The API engine returned invalid response output.");
    }
}

function isObjectSchema(schema: Record<string, unknown>) {
    return (schema?.type === "object" ||
        (Array.isArray(schema?.type) && schema.type.includes("object")));
}

function assertOpenAIStrictSchema(rootSchema: unknown) {
    const visited = new Set();
    function visit(schema: unknown, isRoot = false) {
        if (!schema || typeof schema !== "object") {
            if (isRoot) {
                throw new Error(STRICT_TOOL_SCHEMA_ERROR);
            }
            return;
        }
        if (visited.has(schema)) {
            return;
        }
        visited.add(schema);
        if (Array.isArray(schema)) {
            if (isRoot) {
                throw new Error(STRICT_TOOL_SCHEMA_ERROR);
            }
            for (const item of schema) {
                visit(item);
            }
            return;
        }
        if (!isRecord(schema)) return;
        if (isRoot || isObjectSchema(schema) || Object.hasOwn(schema, "properties")) {
            const properties = schema.properties;
            const required = schema.required;
            const propertyNames = properties && typeof properties === "object" && !Array.isArray(properties)
                ? Object.keys(properties)
                : null;
            const requiredNames = Array.isArray(required) ? new Set(required) : null;
            if ((isRoot ? schema.type !== "object" : !isObjectSchema(schema)) ||
                propertyNames === null ||
                schema.additionalProperties !== false ||
                requiredNames === null ||
                requiredNames.size !== propertyNames.length ||
                !propertyNames.every((name) => requiredNames.has(name))) {
                throw new Error(STRICT_TOOL_SCHEMA_ERROR);
            }
        }
        for (const schemaMap of [
            schema.properties,
            schema.$defs,
            schema.definitions,
            schema.dependentSchemas,
            schema.patternProperties
        ]) {
            if (schemaMap && typeof schemaMap === "object" && !Array.isArray(schemaMap)) {
                for (const childSchema of Object.values(schemaMap)) {
                    visit(childSchema);
                }
            }
        }
        for (const childSchema of [
            schema.items,
            schema.prefixItems,
            schema.contains,
            schema.not,
            schema.if,
            schema.then,
            schema.else,
            schema.propertyNames,
            schema.anyOf,
            schema.oneOf,
            schema.allOf
        ]) {
            visit(childSchema);
        }
    }
    visit(rootSchema, true);
}

function isNonJsonResponseError(error: unknown) {
    return error instanceof Error && error.message === "The API engine returned non-JSON response.";
}

function extractOptionalResponseText(response: Response) {
    if (typeof response?.output_text === "string" && response.output_text.trim()) {
        return response.output_text.trim();
    }
    const chunks = [];
    for (const item of response?.output ?? []) {
        for (const content of (isRecord(item) && Array.isArray(item.content) ? item.content : [])) {
            if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
                chunks.push(content.text);
            }
        }
    }
    const text = chunks.join("\n").trim();
    if (text.length > 0) {
        return text;
    }
    return "";
}

function extractResponseText(response: Response) {
    const text = extractOptionalResponseText(response);
    if (text) {
        return text;
    }
    throw new Error("The API engine returned no text output.");
}

export class OpenAIEngine implements Extract<Engine, { capabilities: { toolCalling: true } }> {
    llmConfig: LlmConfig;
    model: string;
    apiKey: string;
    baseURL: string;
    timeoutMs: number;
    maxRetries: number;
    client: LlmClient | null;
    clientFactory: LlmClientFactory;
    fetchImpl: typeof globalThis.fetch | undefined;
    clientPromise: Promise<LlmClient> | null;
    name = "openai";
    capabilities = { toolCalling: true as const };
    constructor(options: ApiEngineOptions = {}) {
        // A directly injected client performs no credential-bearing client creation.
        const resolverOptions = options.client && options.apiKey === undefined
            ? { ...options, apiKey: "injected-client" }
            : options;
        this.llmConfig = options.config ?? resolveLlmConfig(resolverOptions);
        this.model = this.llmConfig.model;
        this.apiKey = this.llmConfig.apiKey;
        this.baseURL = this.llmConfig.baseURL;
        this.timeoutMs = this.llmConfig.timeoutMs;
        this.maxRetries = this.llmConfig.maxRetries;
        this.client = options.client ?? null;
        this.clientFactory = options.clientFactory ?? createLlmClient;
        this.fetchImpl = options.fetchImpl;
        this.clientPromise = null;
    }
    async generateCommand(context: SolveContext, { signal }: { signal?: AbortSignal } = {}) {
        const client = await this.#getClient();
        let lastError;
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            try {
                const response = await requestLlmResponse(client, {
                    model: this.model,
                    store: false,
                    ...reasoningOptions(this.model),
                    input: [
                        {
                            role: "system",
                            content: [{ type: "input_text", text: buildSystemPrompt() }]
                        },
                        {
                            role: "user",
                            content: [{ type: "input_text", text: buildUserPrompt(context) }]
                        }
                    ]
                }, { signal });
                if (response?.status != null && response.status !== "completed") {
                    throw new Error("The API engine returned a non-completed response.");
                }
                assertResponseOutput(response);
                return parseEngineResponse(extractResponseText(response));
            }
            catch (error) {
                if (!isNonJsonResponseError(error) || attempt >= this.maxRetries) {
                    throw error;
                }
                lastError = error;
            }
        }
        throw lastError ?? new Error("The API engine returned non-JSON response.");
    }
    async generateTurn({ context, tools, continuation, toolResults = [], signal }: GenerateTurnInput): Promise<EngineTurn> {
        if (!Array.isArray(toolResults) || (continuation === undefined && toolResults.length > 0)) {
            throw new Error("The API engine received invalid Tool results.");
        }
        const openaiTools: FunctionTool[] = tools.map(({ name, description, parameters }) => {
            assertOpenAIStrictSchema(parameters);
            return {
                type: "function",
                name,
                description,
                parameters,
                strict: true
            };
        });
        const request: ResponseCreateParamsNonStreaming = continuation !== undefined
            ? {
                model: this.model,
                input: resumeResponsesInput(continuation, toolResults),
                tools: openaiTools
            }
            : {
                model: this.model,
                input: [
                    {
                        role: "system",
                        content: [{ type: "input_text", text: buildSystemPrompt() }]
                    },
                    {
                        role: "user",
                        content: [{ type: "input_text", text: buildUserPrompt(context) }]
                    }
                ],
                tools: openaiTools
            };
        const client = await this.#getClient();
        request.store = false;
        Object.assign(request, reasoningOptions(this.model));
        const response = await requestLlmResponse(client, request, { signal });
        if (response?.status != null && response.status !== "completed") {
            throw new Error("The API engine returned a non-completed response.");
        }
        assertResponseOutput(response);
        const functionCalls = (response?.output ?? []).filter((item) => item?.type === "function_call");
        const calls = parseResponsesToolCalls(response?.output ?? []);
        if (functionCalls.length > 0 && !isNonEmptyString(response.id)) {
            throw new Error("The API engine returned Tool calls without a response ID.");
        }
        const commandText = extractOptionalResponseText(response);
        if (functionCalls.length > 0 && commandText) {
            throw new Error("The API engine returned both a command and Tool calls.");
        }
        if (calls.length > 0) {
            return {
                type: "tool_calls",
                calls,
                continuation: createResponsesContinuation(Array.isArray(request.input) ? request.input : [], response.output)
            };
        }
        return {
            type: "command",
            ...parseEngineResponse(commandText || extractResponseText(response))
        };
    }
    async #getClient() {
        if (this.client) {
            return this.client;
        }
        this.clientPromise ??= Promise.resolve().then(() => this.clientFactory({
            apiKey: this.apiKey,
            baseURL: this.baseURL,
            timeoutMs: this.timeoutMs,
            maxRetries: this.maxRetries,
            ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl })
        }));
        this.client = await this.clientPromise;
        return this.client;
    }
}

export function __testUtils() {
    return {
        buildUserPrompt,
        extractResponseText,
        parseEngineResponse
    };
}
