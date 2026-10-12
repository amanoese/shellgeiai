const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function normalizeBaseURL(value) {
  requireText(value, "baseURL / LLM_BASE_URL");
  let url;
  try {
    url = new URL(value);
  } catch {
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

function requireInteger(value, name, min, max) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be a safe integer from ${min} to ${max}.`);
  }
  return number;
}

/** Resolve credentials only after identifying the exact destination endpoint. */
export function resolveLlmConfig(options = {}, { env = process.env } = {}) {
  const usesLegacyURL = options.baseURL === undefined && env.LLM_BASE_URL === undefined &&
    env.OPENAI_BASE_URL !== undefined;
  if (usesLegacyURL) {
    process.emitWarning("OPENAI_BASE_URL is deprecated; use LLM_BASE_URL instead.", {
      type: "DeprecationWarning",
      code: "SHELLGEIAI_DEPRECATED_OPENAI_BASE_URL"
    });
  }
  const baseURL = normalizeBaseURL(firstDefined(
    options.baseURL, env.LLM_BASE_URL, env.OPENAI_BASE_URL, OPENROUTER_BASE_URL
  ));
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
  const model = requireText(firstDefined(
    options.model, env.SHELLGEIAI_LLM_MODEL, isOpenAI ? env.OPENAI_MODEL : undefined, defaultModel
  ), "model / SHELLGEIAI_LLM_MODEL");
  const plannerModel = requireText(firstDefined(
    options.plannerModel, env.SHELLGEIAI_PLANNER_MODEL, isOpenAI ? env.OPENAI_PLANNER_MODEL : undefined, model
  ), "plannerModel / SHELLGEIAI_PLANNER_MODEL");
  const timeoutMs = requireInteger(firstDefined(
    options.timeoutMs, env.SHELLGEIAI_LLM_TIMEOUT_MS, isOpenAI ? env.OPENAI_TIMEOUT_MS : undefined, 30000
  ), "timeoutMs / SHELLGEIAI_LLM_TIMEOUT_MS", 1, Number.MAX_SAFE_INTEGER);
  const maxRetries = requireInteger(firstDefined(
    options.maxRetries, env.SHELLGEIAI_LLM_MAX_RETRIES, isOpenAI ? env.OPENAI_MAX_RETRIES : undefined, 2
  ), "maxRetries / SHELLGEIAI_LLM_MAX_RETRIES", 0, 5);

  return { provider, baseURL, apiKey, model, plannerModel, timeoutMs, maxRetries };
}

/** Public logs use an allowlist so newly added private fields stay private. */
export function publicLlmSnapshot(config) {
  const { provider, baseURL, model, plannerModel, timeoutMs, maxRetries } = config;
  return { provider, baseURL, model, plannerModel, timeoutMs, maxRetries };
}
