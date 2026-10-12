const MAX_TIMEOUT_MS = 2147483647;

/** Keep provider responses, request data, headers, and SDK causes out of logs. */
export function safeLlmError(error) {
  const errorType = error?.constructor?.name;
  if (error?.name === "AbortError" || error?.name === "APIUserAbortError" || errorType === "APIUserAbortError") {
    const cancelled = new Error("The LLM API request was cancelled.");
    cancelled.name = "AbortError";
    return cancelled;
  }
  if (error?.name === "APIConnectionTimeoutError" || errorType === "APIConnectionTimeoutError") {
    return new Error("The LLM API request timed out.");
  }
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
    ? error.status : null;
  const hints = {
    400: "Check the request and model configuration.",
    401: "Check the API key for the configured endpoint.",
    402: "Check the provider account credits.",
    403: "Check endpoint and model access permissions.",
    404: "Check that the endpoint supports the Responses API and the configured model.",
    429: "The provider rate limit was reached. Retry later."
  };
  const hint = hints[status] ?? (status >= 500 ? "The provider is unavailable. Retry later." : "Check the endpoint and connection.");
  return new Error(`The LLM API request failed${status === null ? "" : ` (HTTP ${status})`}. ${hint}`);
}

/** One SDK call: transport retries belong exclusively to the SDK. */
export async function requestLlmResponse(client, request, { signal } = {}) {
  try {
    return await client.responses.create(request, { signal });
  } catch (error) {
    throw safeLlmError(error);
  }
}

export async function createLlmClient({ apiKey, baseURL, timeoutMs, maxRetries, fetchImpl = globalThis.fetch }) {
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
    if (typeof baseURL !== "string" || !baseURL.trim()) throw new Error();
    endpoint = new URL(baseURL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
    if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) ||
      endpoint.username || endpoint.password || baseURL.split("/")[2]?.includes("@") ||
      baseURL.includes("?") || baseURL.includes("#")) throw new Error();
  } catch {
    throw new Error("baseURL must be an explicit HTTPS endpoint (loopback HTTP allowed) without userinfo, query, or fragment.");
  }
  let OpenAI;
  try {
    ({ default: OpenAI } = await import("openai"));
  } catch {
    throw new Error("The 'openai' package is not installed. Run 'npm install' and try again.");
  }
  const endpointPath = `${endpoint.pathname.replace(/\/$/, "")}/`;
  const fetch = async (url, init = {}) => {
    const destination = new URL(url);
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
