import { afterEach, describe, expect, it } from "vitest";
import {
  GEMINI_DEFAULT_MODEL,
  GeminiLlm,
  createLlm,
  llmBanner,
} from "../src/llm/provider";

const ENV_KEYS = [
  "LLM_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_INPUT_USD_PER_MTOK",
  "GEMINI_OUTPUT_USD_PER_MTOK",
  "OPENAI_MODEL",
] as const;

const previous = new Map<string, string | undefined>();

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!previous.has(key)) {
    previous.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previous.clear();
});

describe("gemini provider", () => {
  it("names the active provider and model", () => {
    setEnv("LLM_PROVIDER", undefined);
    expect(llmBanner()).toMatchObject({ provider: "demo", model: "demo" });
    expect(llmBanner().text).toContain("Provider: demo, model: demo");

    setEnv("LLM_PROVIDER", "gemini");
    setEnv("GEMINI_MODEL", undefined);
    expect(llmBanner()).toMatchObject({
      provider: "gemini",
      model: GEMINI_DEFAULT_MODEL,
      text: `AI aktif: Gemini, model ${GEMINI_DEFAULT_MODEL}.`,
    });

    setEnv("LLM_PROVIDER", "openai");
    setEnv("OPENAI_MODEL", "gpt-4o-mini");
    expect(llmBanner().text).toBe("AI aktif: OpenAI, model gpt-4o-mini.");
  });

  it("posts structured JSON to the Gemini API and prices tokens", async () => {
    setEnv("GEMINI_API_KEY", "test-key");
    setEnv("GEMINI_MODEL", undefined);
    setEnv("GEMINI_INPUT_USD_PER_MTOK", "0.30");
    setEnv("GEMINI_OUTPUT_USD_PER_MTOK", "2.50");
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const llm = new GeminiLlm(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
          usageMetadata: {
            promptTokenCount: 1000,
            candidatesTokenCount: 500,
            thoughtsTokenCount: 100,
          },
        }),
      };
    });
    const result = await llm.complete({ purpose: "score", system: "sistem", user: "cuplikan" });
    expect(result).toMatchObject({ text: '{"ok":true}', model: GEMINI_DEFAULT_MODEL });
    expect(result.costUsd).toBeCloseTo(0.0018);
    expect(calls[0]?.url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent`,
    );
    expect(calls[0]?.init.headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(calls[0]?.init.body ?? "{}") as {
      systemInstruction: { parts: { text: string }[] };
      generationConfig: { responseMimeType: string; responseSchema: { properties: Record<string, unknown> } };
    };
    expect(body.systemInstruction.parts[0]?.text).toBe("sistem");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.properties.aspects).toBeTruthy();
  });

  it("uses GEMINI_MODEL and treats a rate limit like any other HTTP error", async () => {
    setEnv("GEMINI_API_KEY", "test-key");
    setEnv("GEMINI_MODEL", "gemini-2.5-flash");
    const seen: string[] = [];
    const llm = new GeminiLlm(async (url) => {
      seen.push(url);
      return { ok: false, status: 429, json: async () => ({}) };
    });
    await expect(
      llm.complete({ purpose: "copy", system: "sistem", user: "cuplikan" }),
    ).rejects.toThrow("Gemini 429");
    expect(seen[0]).toContain("/models/gemini-2.5-flash:generateContent");
    expect(seen[0]).not.toContain("test-key");
  });

  it("refuses to call Gemini without a key and records zero cost when usage is missing", async () => {
    setEnv("LLM_PROVIDER", "gemini");
    setEnv("GEMINI_API_KEY", undefined);
    await expect(
      createLlm().complete({ purpose: "score", system: "", user: "" }),
    ).rejects.toThrow("GEMINI_API_KEY missing");

    setEnv("GEMINI_API_KEY", "test-key");
    const llm = new GeminiLlm(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    }));
    const result = await llm.complete({ purpose: "copy", system: "", user: "" });
    expect(result.costUsd).toBe(0);
  });
});
