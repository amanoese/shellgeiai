import { afterEach, describe, expect, it, vi } from "vitest";

import { publicLlmSnapshot, resolveLlmConfig } from "../dist/providers/llm/config.js";

const routerEnv = { OPENROUTER_API_KEY: "router-key" };

afterEach(() => vi.restoreAllMocks());

describe("resolveLlmConfig", () => {
  it("defaults both roles to OpenRouter with bounded request settings", () => {
    expect(resolveLlmConfig({}, { env: routerEnv })).toEqual({
      provider: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "router-key",
      model: "openai/gpt-6.1-sol",
      plannerModel: "openai/gpt-6.1-sol",
      timeoutMs: 30000,
      maxRetries: 2
    });
  });

  it("uses options before generic environment and provider defaults", () => {
    expect(resolveLlmConfig({
      baseURL: "https://api.openai.com/v1/",
      apiKey: "option-key",
      model: "option-model",
      plannerModel: "option-planner",
      timeoutMs: 12000,
      maxRetries: 0
    }, { env: {
      ...routerEnv,
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
      SHELLGEIAI_LLM_API_KEY: "generic-key",
      SHELLGEIAI_LLM_MODEL: "generic-model",
      SHELLGEIAI_PLANNER_MODEL: "generic-planner",
      SHELLGEIAI_LLM_TIMEOUT_MS: "25000",
      SHELLGEIAI_LLM_MAX_RETRIES: "4"
    } })).toEqual({
      provider: "openai",
      baseURL: "https://api.openai.com/v1",
      apiKey: "option-key",
      model: "option-model",
      plannerModel: "option-planner",
      timeoutMs: 12000,
      maxRetries: 0
    });
  });

  it("uses generic environment settings before OpenAI legacy settings", () => {
    expect(resolveLlmConfig({}, { env: {
      LLM_BASE_URL: "https://api.openai.com/v1",
      SHELLGEIAI_LLM_API_KEY: "generic-key",
      SHELLGEIAI_LLM_MODEL: "generic-model",
      SHELLGEIAI_PLANNER_MODEL: "generic-planner",
      SHELLGEIAI_LLM_TIMEOUT_MS: "15000",
      SHELLGEIAI_LLM_MAX_RETRIES: "5",
      OPENAI_API_KEY: "openai-key",
      OPENAI_MODEL: "old-model",
      OPENAI_PLANNER_MODEL: "old-planner",
      OPENAI_TIMEOUT_MS: "1",
      OPENAI_MAX_RETRIES: "1"
    } })).toMatchObject({
      provider: "openai", apiKey: "generic-key", model: "generic-model",
      plannerModel: "generic-planner", timeoutMs: 15000, maxRetries: 5
    });
  });

  it("uses OpenAI key and bare model only at the OpenAI endpoint", () => {
    expect(resolveLlmConfig({}, { env: {
      LLM_BASE_URL: "https://api.openai.com/v1", OPENAI_API_KEY: "openai-key", ...routerEnv
    } })).toMatchObject({
      provider: "openai", apiKey: "openai-key", model: "gpt-6.1-sol", plannerModel: "gpt-6.1-sol"
    });
  });

  it("supports legacy OpenAI role and request settings at the OpenAI endpoint", () => {
    expect(resolveLlmConfig({}, { env: {
      LLM_BASE_URL: "https://api.openai.com/v1",
      OPENAI_API_KEY: "openai-key", OPENAI_MODEL: "old-model", OPENAI_PLANNER_MODEL: "old-planner",
      OPENAI_TIMEOUT_MS: "5000", OPENAI_MAX_RETRIES: "0"
    } })).toMatchObject({ model: "old-model", plannerModel: "old-planner", timeoutMs: 5000, maxRetries: 0 });
  });

  it("ignores legacy OpenAI role and request settings at OpenRouter", () => {
    expect(resolveLlmConfig({}, { env: {
      ...routerEnv, OPENAI_API_KEY: "openai-key", OPENAI_MODEL: "", OPENAI_PLANNER_MODEL: "",
      OPENAI_TIMEOUT_MS: "invalid", OPENAI_MAX_RETRIES: "invalid"
    } })).toMatchObject({
      apiKey: "router-key", model: "openai/gpt-6.1-sol", plannerModel: "openai/gpt-6.1-sol",
      timeoutMs: 30000, maxRetries: 2
    });
  });

  it("keeps explicit model IDs unchanged and lets the planner inherit the worker model", () => {
    expect(resolveLlmConfig({ model: "vendor/custom-model" }, { env: routerEnv }))
      .toMatchObject({ model: "vendor/custom-model", plannerModel: "vendor/custom-model" });
  });

  it("lets a generic planner override the inherited worker model", () => {
    expect(resolveLlmConfig({ model: "worker-model" }, {
      env: { ...routerEnv, SHELLGEIAI_PLANNER_MODEL: "planner-model" }
    })).toMatchObject({ model: "worker-model", plannerModel: "planner-model" });
  });

  it.each([
    ["https://openrouter.ai/api/v1/", "openrouter", "https://openrouter.ai/api/v1"],
    ["https://OPENROUTER.AI:443/api/v1", "openrouter", "https://openrouter.ai/api/v1"],
    ["https://api.openai.com/v1/", "openai", "https://api.openai.com/v1"]
  ])("recognizes the parsed origin and exact normalized base path: %s", (baseURL, provider, normalized) => {
    expect(resolveLlmConfig({ baseURL }, { env: { ...routerEnv, OPENAI_API_KEY: "openai-key" } }))
      .toMatchObject({ provider, baseURL: normalized });
  });

  it.each([
    "https://openrouter.ai.evil.example/api/v1",
    "https://evil.example/openrouter.ai/api/v1",
    "https://openrouter.ai/api/v1/extra",
    "https://openrouter.ai/api/v10",
    "https://openrouter.ai:444/api/v1",
    "https://api.openai.com/v1/extra"
  ])("does not forward provider keys to an unknown endpoint: %s", (baseURL) => {
    expect(() => resolveLlmConfig({ baseURL, model: "explicit-model" }, {
      env: { ...routerEnv, OPENAI_API_KEY: "openai-key" }
    })).toThrow(/SHELLGEIAI_LLM_API_KEY|apiKey/);
  });

  it("requires an explicit model at a custom endpoint", () => {
    expect(() => resolveLlmConfig({ baseURL: "https://custom.example/v1", apiKey: "custom-key" }, { env: {} }))
      .toThrow(/SHELLGEIAI_LLM_MODEL|model/);
  });

  it("accepts generic credentials and model at a custom HTTPS endpoint", () => {
    expect(resolveLlmConfig({}, { env: {
      LLM_BASE_URL: "https://custom.example/v1",
      SHELLGEIAI_LLM_API_KEY: "custom-key", SHELLGEIAI_LLM_MODEL: "custom-model",
      OPENAI_MODEL: "old-model", OPENAI_PLANNER_MODEL: "old-planner",
      OPENAI_TIMEOUT_MS: "1", OPENAI_MAX_RETRIES: "1"
    } })).toMatchObject({
      provider: "custom", apiKey: "custom-key", model: "custom-model", plannerModel: "custom-model",
      timeoutMs: 30000, maxRetries: 2
    });
  });

  it.each(["http://localhost:8080/v1", "http://127.0.0.1:8080/v1", "http://[::1]:8080/v1"])
    ("accepts loopback HTTP with explicit credentials: %s", (baseURL) => {
      expect(resolveLlmConfig({ baseURL, apiKey: "local-key", model: "local-model" }, { env: {} }))
        .toMatchObject({ provider: "custom", baseURL, model: "local-model", plannerModel: "local-model" });
    });

  it.each([
    "not-a-url", "http://custom.example/v1", "ftp://localhost/v1",
    "https://user:secret@openrouter.ai/api/v1", "https://@openrouter.ai/api/v1",
    "https://openrouter.ai/api/v1?token=secret", "https://openrouter.ai/api/v1?",
    "https://openrouter.ai/api/v1#secret", "https://openrouter.ai/api/v1#",
    "http://localhost.evil.example/v1"
  ])("rejects invalid or unsafe base URLs without echoing them: %s", (baseURL) => {
    const resolve = () => resolveLlmConfig({ baseURL, apiKey: "secret-key", model: "model" }, { env: {} });
    expect(resolve).toThrow(/baseURL|LLM_BASE_URL/);
    try { resolve(); } catch (error) {
      expect(error.message).not.toContain(baseURL);
      expect(error.message).not.toContain("secret");
    }
  });

  it.each(["baseURL", "apiKey", "model", "plannerModel", "timeoutMs", "maxRetries"])
    ("rejects explicit empty %s instead of falling back", (name) => {
      expect(() => resolveLlmConfig({ [name]: "" }, { env: routerEnv })).toThrow();
    });

  it.each([
    "LLM_BASE_URL", "SHELLGEIAI_LLM_API_KEY", "SHELLGEIAI_LLM_MODEL", "SHELLGEIAI_PLANNER_MODEL",
    "SHELLGEIAI_LLM_TIMEOUT_MS", "SHELLGEIAI_LLM_MAX_RETRIES"
  ])("rejects an empty selected environment setting: %s", (name) => {
    expect(() => resolveLlmConfig({}, { env: { ...routerEnv, [name]: "" } })).toThrow();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, null, true, "invalid"])
    ("rejects invalid option timeoutMs: %s", (timeoutMs) => {
      expect(() => resolveLlmConfig({ timeoutMs }, { env: routerEnv })).toThrow(/timeoutMs/);
    });

  it.each(["0", "-1", "1.5", "9007199254740992", "invalid"])
    ("rejects invalid environment timeoutMs: %s", (timeoutMs) => {
      expect(() => resolveLlmConfig({}, { env: { ...routerEnv, SHELLGEIAI_LLM_TIMEOUT_MS: timeoutMs } }))
        .toThrow(/timeoutMs/);
    });

  it.each([0, 5])("accepts the maxRetries boundary %s", (maxRetries) => {
    expect(resolveLlmConfig({ maxRetries }, { env: routerEnv }).maxRetries).toBe(maxRetries);
  });

  it.each([-1, 6, 0.5, Number.MAX_SAFE_INTEGER + 1, null, true, "invalid"])
    ("rejects invalid option maxRetries: %s", (maxRetries) => {
      expect(() => resolveLlmConfig({ maxRetries }, { env: routerEnv })).toThrow(/maxRetries/);
    });

  it.each(["-1", "6", "0.5", "9007199254740992", "invalid"])
    ("rejects invalid environment maxRetries: %s", (maxRetries) => {
      expect(() => resolveLlmConfig({}, { env: { ...routerEnv, SHELLGEIAI_LLM_MAX_RETRIES: maxRetries } }))
        .toThrow(/maxRetries/);
    });

  it("warns without exposing the deprecated OPENAI_BASE_URL value", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    expect(resolveLlmConfig({}, { env: {
      OPENAI_BASE_URL: "https://api.openai.com/v1/", OPENAI_API_KEY: "secret-key"
    } }).provider).toBe("openai");
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).toMatch(/OPENAI_BASE_URL.*LLM_BASE_URL/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("https://");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-key");
  });

  it("does not warn for an unused legacy base URL", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    resolveLlmConfig({}, { env: {
      ...routerEnv, LLM_BASE_URL: "https://openrouter.ai/api/v1", OPENAI_BASE_URL: ""
    } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("explains the new key and deliberate OpenAI migration when the default key is missing", () => {
    expect(() => resolveLlmConfig({}, { env: { OPENAI_API_KEY: "secret-key" } }))
      .toThrow(/OPENROUTER_API_KEY.*LLM_BASE_URL=https:\/\/api\.openai\.com\/v1/);
  });

  it("does not substitute a router key for a missing OpenAI key", () => {
    expect(() => resolveLlmConfig({ baseURL: "https://api.openai.com/v1" }, { env: routerEnv }))
      .toThrow(/OPENAI_API_KEY/);
  });
});

describe("publicLlmSnapshot", () => {
  it("allowlists only public configuration even if unexpected secret fields exist", () => {
    const config = resolveLlmConfig({}, { env: routerEnv });
    expect(publicLlmSnapshot({ ...config, apiKey: "secret-key", token: "secret-token", client: {} }))
      .toEqual({
        provider: "openrouter", baseURL: "https://openrouter.ai/api/v1",
        model: "openai/gpt-6.1-sol", plannerModel: "openai/gpt-6.1-sol", timeoutMs: 30000, maxRetries: 2
      });
  });
});
