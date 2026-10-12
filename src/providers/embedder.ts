import type { KnowledgeEmbedder } from "../types.js";
type SignalOptions = { signal?: AbortSignal };
export interface EmbedderOptions {
    model?: string; apiKey?: string; timeoutMs?: number | string; maxRetries?: number | string;
    fetchImpl?: typeof globalThis.fetch; sleep?: (delay: number, options: SignalOptions) => PromiseLike<void>; random?: () => number;
}
class EmbeddingRequestError extends Error { retryable = false; response?: Response }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isNumberVector(value: unknown): value is number[] { return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "number" && Number.isFinite(item)); }
import { DEFAULT_KNOWLEDGE_MODEL } from "../knowledge/modelConfig.js";

const ENDPOINT = "https://openrouter.ai/api/v1/embeddings";

const MAX_BACKOFF_MS = 10000;

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

function configurationInteger(value: unknown, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" ||
        !Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw new Error(`Invalid embedding ${label} setting.`);
    }
    return number;
}

function cancellationError() {
    return new Error("Embedding request cancelled.");
}

function abortable<T>(promise: PromiseLike<T>, signal: AbortSignal, error = cancellationError): Promise<T> {
    if (signal.aborted)
        return Promise.reject(error());
    return new Promise((resolve, reject) => {
        const onAbort = () => { cleanup(); reject(error()); };
        const cleanup = () => signal.removeEventListener("abort", onAbort);
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(promise).then((value) => { cleanup(); resolve(value); }, (failure) => { cleanup(); reject(failure); });
    });
}

function wait(delay: number, { signal }: SignalOptions = {}) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(cancellationError());
            return;
        }
        const timer = setTimeout(() => { cleanup(); resolve(); }, delay);
        const onAbort = () => { clearTimeout(timer); cleanup(); reject(cancellationError()); };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function retryDelay(response: Response | undefined, retry: number, random: () => number) {
    const retryAfter = response?.headers?.get("retry-after");
    if (retryAfter) {
        const seconds = Number(retryAfter);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(delay) && delay >= 0)
            return Math.min(MAX_BACKOFF_MS, delay);
    }
    return Math.min(MAX_BACKOFF_MS, 500 * (2 ** retry) + 250 * random());
}

function isTransientNetworkError(error: unknown) {
    const code = isRecord(error) ? error.code : undefined;
    const cause = isRecord(error) && isRecord(error.cause) ? error.cause.code : undefined;
    return error instanceof TypeError || (typeof code === "string" && NETWORK_CODES.has(code)) || (typeof cause === "string" && NETWORK_CODES.has(cause));
}

function validateVectors(payload: unknown, count: number, model: string, expectedDimension: number | undefined) {
    // OpenRouter's Qwen provider returns its upstream name instead of the request slug.
    // Accept only this observed alias; other models must still match exactly.
    const matchesModel = isRecord(payload) && (payload.model === model ||
        (model === "qwen/qwen3-embedding-8b" && payload.model === "Qwen/Qwen3-Embedding-8B"));
    if (!isRecord(payload) || !matchesModel)
        throw new Error("Embedding response model does not match the requested model.");
    if (!Array.isArray(payload.data) || payload.data.length !== count)
        throw new Error("Invalid embedding response item count.");
    const vectors: number[][] = new Array(count);
    let dimension = expectedDimension;
    const items: unknown[] = payload.data;
    for (const item of items) {
        if (!isRecord(item) || typeof item.index !== "number" || !Number.isInteger(item.index) || item.index < 0 || item.index >= count || vectors[item.index]) {
            throw new Error("Invalid embedding response index.");
        }
        const vector = item.embedding;
        if (!isNumberVector(vector)) {
            throw new Error("Invalid embedding response vector.");
        }
        if (dimension !== undefined && vector.length !== dimension)
            throw new Error("Embedding vector dimension does not match.");
        dimension ??= vector.length;
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        const floatVector = Array.from(Float32Array.from(vector));
        const floatNorm = Math.sqrt(floatVector.reduce((sum, value) => sum + value * value, 0));
        if (!Number.isFinite(norm) || norm === 0 || floatVector.some((value) => !Number.isFinite(value)) || !Number.isFinite(floatNorm) || floatNorm === 0) {
            throw new Error("Invalid embedding response vector norm.");
        }
        vectors[item.index] = floatVector;
    }
    return { vectors, dimension };
}

export function createOpenRouterEmbedder({ model = DEFAULT_KNOWLEDGE_MODEL, apiKey = process.env.OPENROUTER_API_KEY, timeoutMs = process.env.SHELLGEIAI_EMBEDDING_TIMEOUT_MS ?? 30000, maxRetries = process.env.SHELLGEIAI_EMBEDDING_MAX_RETRIES ?? 2, fetchImpl = globalThis.fetch, sleep = wait, random = Math.random }: EmbedderOptions = {}): KnowledgeEmbedder & { embedBatch: NonNullable<KnowledgeEmbedder["embedBatch"]> } {
    const timeout = configurationInteger(timeoutMs, "timeout", 1);
    const retries = configurationInteger(maxRetries, "retry", 0, 5);
    let dimension = model === DEFAULT_KNOWLEDGE_MODEL ? 4096 : undefined;
    async function request(input: string[], key: string, externalSignal?: AbortSignal) {
        const controller = new AbortController();
        let timedOut = false;
        const onExternalAbort = () => controller.abort();
        externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
        if (externalSignal?.aborted)
            controller.abort();
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
        const abortError = () => timedOut ? new Error("Embedding request timed out.") : cancellationError();
        try {
            if (controller.signal.aborted)
                throw abortError();
            let response;
            try {
                response = await abortable(fetchImpl(ENDPOINT, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ model, input, encoding_format: "float" }),
                    signal: controller.signal
                }), controller.signal, abortError);
            }
            catch (error) {
                if (controller.signal.aborted)
                    throw abortError();
                const failure = new EmbeddingRequestError(isTransientNetworkError(error) ? "Embedding network request failed." : "Embedding request failed.");
                failure.retryable = isTransientNetworkError(error);
                throw failure;
            }
            if (!response.ok) {
                // Release unread error bodies before a retry can occupy another connection.
                void response.body?.cancel().catch(() => { });
                const failure = new EmbeddingRequestError(`Embedding request failed (HTTP ${response.status}).`);
                failure.retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
                failure.response = response;
                throw failure;
            }
            let payload;
            try {
                payload = await abortable(response.json(), controller.signal, abortError);
            }
            catch (error) {
                if (controller.signal.aborted)
                    throw abortError();
                if (isTransientNetworkError(error)) {
                    const failure = new EmbeddingRequestError("Embedding network response read failed.");
                    failure.retryable = true;
                    throw failure;
                }
                throw new Error("Invalid embedding response JSON.");
            }
            const validated = validateVectors(payload, input.length, model, dimension);
            dimension = validated.dimension;
            return validated.vectors;
        }
        finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", onExternalAbort);
            controller.abort();
        }
    }
    async function embedBatch(texts: string[], { signal }: SignalOptions = {}) {
        if (typeof apiKey !== "string" || !apiKey.trim())
            throw new Error("OPENROUTER_API_KEY is required for embeddings.");
        if (!Array.isArray(texts) || texts.length === 0 || texts.some((text) => typeof text !== "string" || !text.trim())) {
            throw new Error("Embedding input must contain nonblank text strings.");
        }
        const input = texts.map((text) => text.trim());
        for (let retry = 0;; retry += 1) {
            if (signal?.aborted)
                throw cancellationError();
            try {
                return await request(input, apiKey, signal);
            }
            catch (error) {
                if (signal?.aborted)
                    throw cancellationError();
                if (!(error instanceof EmbeddingRequestError) || !error.retryable || retry >= retries) {
                    // Return a fresh error so transport objects and response bodies cannot escape.
                    throw new Error(error instanceof Error ? error.message : "Embedding request failed.");
                }
                const delay = retryDelay(error.response, retry, random);
                try {
                    await abortable(sleep(delay, { signal }), signal ?? new AbortController().signal);
                }
                catch {
                    if (signal?.aborted)
                        throw cancellationError();
                    throw new Error("Embedding retry wait failed.");
                }
            }
        }
    }
    return {
        embedBatch,
        async embed(text: string, options?: SignalOptions) {
            return (await embedBatch([text], options))[0];
        }
    };
}
