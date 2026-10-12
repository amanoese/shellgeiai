import type { LlmConfig, EngineContinuation, EngineToolCall, EngineToolResult } from "../types.js";
import type { Response, ResponseInput, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type OpenAI from "openai";
import type { LlmClient } from "../types.js";
export type { LlmClient, LlmClientFactory, LlmClientOptions } from "../types.js";
import type { LlmClientOptions } from "../types.js";
export type LlmConfigOptions = Partial<Omit<LlmConfig, "provider" | "timeoutMs" | "maxRetries">> & { timeoutMs?: string | number; maxRetries?: string | number };
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function recordProperty(record: Record<string, unknown>, key: string): unknown { return record[key]; }


const CONTINUATION_ERROR = "The API engine received an invalid continuation.";

const TOOL_RESULTS_ERROR = "The API engine received invalid Tool results.";

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function cloneHistory<T>(input: T): T {
    try {
        return structuredClone(input);
    }
    catch {
        throw new Error(CONTINUATION_ERROR);
    }
}

export function parseResponsesToolCalls(output: readonly unknown[]): EngineToolCall[] {
    const ids = new Set();
    return output.filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "function_call").map((item) => {
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
        let args: unknown;
        try {
            if (typeof item.arguments !== "string")
                throw new Error();
            args = JSON.parse(item.arguments);
        }
        catch {
            throw new Error("The API engine returned invalid Tool call arguments.");
        }
        if (!isRecord(args)) {
            throw new Error("The API engine returned invalid Tool call arguments.");
        }
        return { id: item.call_id, name: item.name, arguments: args };
    });
}

/** Preserve every provider item, including encrypted reasoning, in a private copy. */
export function createResponsesContinuation(input: ResponseInput, output: readonly unknown[]): EngineContinuation {
    return { input: cloneHistory([...input, ...output]) };
}

/** Resume from local history; provider-side stored response IDs are never needed. */
export function resumeResponsesInput(continuation: EngineContinuation, toolResults: EngineToolResult[]): ResponseInput {
    if (!continuation || typeof continuation !== "object" || Array.isArray(continuation) ||
        !Array.isArray(continuation.input) || continuation.input.length === 0) {
        throw new Error(CONTINUATION_ERROR);
    }
    const input: unknown[] = cloneHistory(continuation.input);
    const pending = new Set();
    try {
        parseResponsesToolCalls(input);
        for (const item of input) {
            if (!isRecord(item) ||
                !(isNonEmptyString(item.type) || (isNonEmptyString(item.role) && item.content != null))) {
                throw new Error();
            }
            if (item.type === "function_call") {
                pending.add(item.call_id);
            }
            else if (item.type === "function_call_output") {
                if (!isNonEmptyString(item.call_id) || typeof item.output !== "string" ||
                    !pending.delete(item.call_id)) {
                    throw new Error();
                }
            }
        }
        if (pending.size === 0)
            throw new Error();
    }
    catch {
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
        }
        catch {
            throw new Error("The API engine could not serialize a Tool result.");
        }
        if (typeof output !== "string") {
            throw new Error("The API engine could not serialize a Tool result.");
        }
        input.push({ type: "function_call_output", call_id: callId, output });
    }
    // Provider reasoning and other opaque items must survive unchanged. The checks
    // above validate envelope shape and Tool call/output consistency before reuse.
    return input as ResponseInput;
}

const MAX_TIMEOUT_MS = 2147483647;

/** Keep provider responses, request data, headers, and SDK causes out of logs. */
export function safeLlmError(error: unknown) {
    const details = isRecord(error) ? error : {};
    const constructor = recordProperty(details, "constructor");
    const errorType = typeof constructor === "function" ? constructor.name :
        isRecord(constructor) ? constructor.name : undefined;
    if (details.name === "AbortError" || details.name === "APIUserAbortError" || errorType === "APIUserAbortError") {
        const cancelled = new Error("The LLM API request was cancelled.");
        cancelled.name = "AbortError";
        return cancelled;
    }
    if (details.name === "APIConnectionTimeoutError" || errorType === "APIConnectionTimeoutError") {
        return new Error("The LLM API request timed out.");
    }
    const status = typeof details.status === "number" && Number.isInteger(details.status) && details.status >= 100 && details.status <= 599
        ? details.status : null;
    const hints: Record<number, string> = {
        400: "Check the request and model configuration.",
        401: "Check the API key for the configured endpoint.",
        402: "Check the provider account credits.",
        403: "Check endpoint and model access permissions.",
        404: "Check that the endpoint supports the Responses API and the configured model.",
        429: "The provider rate limit was reached. Retry later."
    };
    const hint = (status === null ? undefined : hints[status]) ?? (status !== null && status >= 500 ? "The provider is unavailable. Retry later." : "Check the endpoint and connection.");
    return new Error(`The LLM API request failed${status === null ? "" : ` (HTTP ${status})`}. ${hint}`);
}

/** One SDK call: transport retries belong exclusively to the SDK. */
export async function requestLlmResponse(client: LlmClient, request: ResponseCreateParamsNonStreaming, { signal }: { signal?: AbortSignal } = {}): Promise<Response> {
    try {
        return await client.responses.create(request, { signal });
    }
    catch (error) {
        throw safeLlmError(error);
    }
}

export async function createLlmClient({ apiKey, baseURL, timeoutMs, maxRetries, fetchImpl = globalThis.fetch }: LlmClientOptions): Promise<OpenAI> {
    if (typeof apiKey !== "string" || !apiKey.trim()) {
        throw new Error("The LLM client requires an explicit non-empty apiKey.");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`timeoutMs must be an integer from 1 to ${MAX_TIMEOUT_MS} for the LLM client.`);
    }
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
        throw new Error("maxRetries must be an integer from 0 to 5 for the LLM client.");
    }
    let endpoint;
    try {
        if (typeof baseURL !== "string" || !baseURL.trim())
            throw new Error();
        endpoint = new URL(baseURL);
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
        if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) ||
            endpoint.username || endpoint.password || baseURL.split("/")[2]?.includes("@") ||
            baseURL.includes("?") || baseURL.includes("#"))
            throw new Error();
    }
    catch {
        throw new Error("baseURL must be an explicit HTTPS endpoint (loopback HTTP allowed) without userinfo, query, or fragment.");
    }
    let OpenAI;
    try {
        ({ default: OpenAI } = await import("openai"));
    }
    catch {
        throw new Error("The 'openai' package is not installed. Run 'npm install' and try again.");
    }
    const endpointPath = `${endpoint.pathname.replace(/\/$/, "")}/`;
    const fetch: typeof globalThis.fetch = async (url, init = {}) => {
        const destination = new URL(url instanceof Request ? url.url : url);
        if (destination.origin !== endpoint.origin || !destination.pathname.startsWith(endpointPath)) {
            throw new Error("The LLM request destination does not match the configured endpoint.");
        }
        // SDK environment defaults must never add other credentials to this endpoint.
        const headers = new Headers({
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`
        });
        return fetchImpl(url, { ...init, headers, redirect: "error" });
    };
    return new OpenAI({
        apiKey,
        baseURL,
        timeout: timeoutMs,
        maxRetries,
        fetch,
        organization: null,
        project: null,
        adminAPIKey: null,
        logLevel: "off"
    });
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function firstDefined(...values: unknown[]): unknown {
    return values.find((value) => value !== undefined);
}

function requireText(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${name} must be a non-empty string.`);
    }
    return value;
}

function normalizeBaseURL(rawValue: unknown) {
    const value = requireText(rawValue, "baseURL / LLM_BASE_URL");
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("baseURL / LLM_BASE_URL must be a valid absolute URL.");
    }
    const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1];
    if (authority === undefined || authority.includes("@") || url.username || url.password ||
        value.includes("?") || value.includes("#")) {
        throw new Error("baseURL / LLM_BASE_URL must not contain userinfo, a query, or a fragment.");
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        throw new Error("baseURL / LLM_BASE_URL requires HTTPS, except for loopback HTTP.");
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href.replace(/\/$/, "");
}

function requireInteger(value: unknown, name: string, min: number, max: number): number {
    const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min || number > max) {
        throw new Error(`${name} must be a safe integer from ${min} to ${max}.`);
    }
    return number;
}

/** Resolve credentials only after identifying the exact destination endpoint. */
export function resolveLlmConfig(options: LlmConfigOptions = {}, { env = process.env }: { env?: NodeJS.ProcessEnv } = {}): LlmConfig {
    const usesLegacyURL = options.baseURL === undefined && env.LLM_BASE_URL === undefined &&
        env.OPENAI_BASE_URL !== undefined;
    if (usesLegacyURL) {
        process.emitWarning("OPENAI_BASE_URL is deprecated; use LLM_BASE_URL instead.", {
            type: "DeprecationWarning",
            code: "SHELLGEIAI_DEPRECATED_OPENAI_BASE_URL"
        });
    }
    const baseURL = normalizeBaseURL(firstDefined(options.baseURL, env.LLM_BASE_URL, env.OPENAI_BASE_URL, OPENROUTER_BASE_URL));
    const provider = baseURL === OPENROUTER_BASE_URL ? "openrouter" :
        baseURL === OPENAI_BASE_URL ? "openai" : "custom";
    const isOpenAI = provider === "openai";
    const providerKey = provider === "openrouter" ? env.OPENROUTER_API_KEY :
        isOpenAI ? env.OPENAI_API_KEY : undefined;
    const selectedKey = firstDefined(options.apiKey, env.SHELLGEIAI_LLM_API_KEY, providerKey);
    if (selectedKey === undefined) {
        if (provider === "openrouter") {
            throw new Error("Set OPENROUTER_API_KEY or SHELLGEIAI_LLM_API_KEY. To use OpenAI, set LLM_BASE_URL=https://api.openai.com/v1 and OPENAI_API_KEY.");
        }
        if (isOpenAI) {
            throw new Error("Set OPENAI_API_KEY or SHELLGEIAI_LLM_API_KEY for the OpenAI endpoint.");
        }
        throw new Error("Custom LLM endpoints require an explicit apiKey or SHELLGEIAI_LLM_API_KEY.");
    }
    const apiKey = requireText(selectedKey, "apiKey / SHELLGEIAI_LLM_API_KEY");
    const defaultModel = provider === "openrouter" ? "openai/gpt-6.1-sol" :
        isOpenAI ? "gpt-6.1-sol" : undefined;
    const model = requireText(firstDefined(options.model, env.SHELLGEIAI_LLM_MODEL, isOpenAI ? env.OPENAI_MODEL : undefined, defaultModel), "model / SHELLGEIAI_LLM_MODEL");
    const plannerModel = requireText(firstDefined(options.plannerModel, env.SHELLGEIAI_PLANNER_MODEL, isOpenAI ? env.OPENAI_PLANNER_MODEL : undefined, model), "plannerModel / SHELLGEIAI_PLANNER_MODEL");
    const timeoutMs = requireInteger(firstDefined(options.timeoutMs, env.SHELLGEIAI_LLM_TIMEOUT_MS, isOpenAI ? env.OPENAI_TIMEOUT_MS : undefined, 30000), "timeoutMs / SHELLGEIAI_LLM_TIMEOUT_MS", 1, Number.MAX_SAFE_INTEGER);
    const maxRetries = requireInteger(firstDefined(options.maxRetries, env.SHELLGEIAI_LLM_MAX_RETRIES, isOpenAI ? env.OPENAI_MAX_RETRIES : undefined, 2), "maxRetries / SHELLGEIAI_LLM_MAX_RETRIES", 0, 5);
    return { provider, baseURL, apiKey, model, plannerModel, timeoutMs, maxRetries };
}

/** Public logs use an allowlist so newly added private fields stay private. */
export function publicLlmSnapshot(config: LlmConfig) {
    const { provider, baseURL, model, plannerModel, timeoutMs, maxRetries } = config;
    return { provider, baseURL, model, plannerModel, timeoutMs, maxRetries };
}
