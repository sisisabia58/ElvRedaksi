import { afterEach, describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import {
  acquireGeminiSlot,
  formatGeminiPause,
  geminiMaxRpm,
  parseGeminiErrorBody,
  parseRetryDelay,
  readGeminiPause,
  recordGeminiPause,
  withGeminiSql,
} from "../src/llm/gemini-gate";
import { GEMINI_DEFAULT_MODEL, GeminiLlm, createLlm, llmBanner } from "../src/llm/provider";

const ENV_KEYS = [
  "LLM_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_INPUT_USD_PER_MTOK",
  "GEMINI_OUTPUT_USD_PER_MTOK",
  "GEMINI_MAX_RPM",
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

  it("uses GEMINI_MODEL and turns a rate limit into a backoff error", async () => {
    setEnv("GEMINI_API_KEY", "test-key");
    setEnv("GEMINI_MODEL", "gemini-2.5-flash");
    const seen: string[] = [];
    const llm = new GeminiLlm(async (url) => {
      seen.push(url);
      return {
        ok: false,
        status: 429,
        headers: { get: (name) => (name.toLowerCase() === "retry-after" ? "7" : null) },
        json: async () => ({}),
      };
    });
    await expect(
      llm.complete({ purpose: "copy", system: "sistem", user: "cuplikan" }),
    ).rejects.toMatchObject({
      name: "LlmRateLimitError",
      retryAfterMs: 7_000,
      countsAsAttempt: false,
      perDay: false,
    });
    expect(seen[0]).toContain("/models/gemini-2.5-flash:generateContent");
    expect(seen[0]).not.toContain("test-key");
  });

  it("backs off when Gemini is unavailable", async () => {
    setEnv("GEMINI_API_KEY", "test-key");
    const llm = new GeminiLlm(async () => ({
      ok: false,
      status: 503,
      headers: { get: () => null },
      json: async () => ({}),
    }));
    await expect(llm.complete({ purpose: "copy", system: "", user: "" })).rejects.toMatchObject({
      name: "LlmRateLimitError",
      message: "Gemini 503",
      retryAfterMs: 20_000,
      countsAsAttempt: true,
    });
  });

  it("backs off when Gemini times out", async () => {
    setEnv("GEMINI_API_KEY", "test-key");
    const llm = new GeminiLlm(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });
    await expect(
      llm.complete({ purpose: "score", system: "sistem", user: "cuplikan" }),
    ).rejects.toMatchObject({ message: "Gemini timeout", retryAfterMs: 20_000, countsAsAttempt: true });
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

  it("reads the free-tier daily quota and retryDelay from a 429 body", async () => {
    setEnv("GEMINI_API_KEY", "test-key");
    const llm = new GeminiLlm(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({
        error: {
          code: 429,
          message:
            "You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 500, model: gemini-3.5-flash-lite. Generate content requests per day limit exceeded on Free Tier. Please retry in 15h4m23.077034076s.",
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                  quotaDimensions: { location: "global", model: "gemini-3.5-flash-lite" },
                  quotaValue: "500",
                },
              ],
            },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "54263s" },
          ],
        },
      }),
    }));
    await expect(llm.complete({ purpose: "score", system: "", user: "" })).rejects.toMatchObject({
      countsAsAttempt: false,
      perDay: true,
      freeTier: true,
      retryAfterMs: 54_263_000,
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      quotaLimit: "500",
      message:
        "Gemini 429: generativelanguage.googleapis.com/generate_content_free_tier_requests limit 500 (GenerateRequestsPerDayPerProjectPerModel-FreeTier)",
    });
  });
});

describe("gemini gate", () => {
  it("parses protobuf and clock retry delays", () => {
    expect(parseRetryDelay("54263s")).toBe(54_263_000);
    expect(parseRetryDelay("15h4m23.077034076s")).toBe(54_263_078);
    const parsed = parseGeminiErrorBody({
      error: {
        message: "requests per minute",
        details: [
          {
            violations: [
              {
                quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
                quotaValue: "15",
              },
            ],
          },
          { retryDelay: "22s" },
        ],
      },
    });
    expect(parsed).toMatchObject({ kind: "minute", perDay: false, freeTier: true, limit: "15" });
    expect(geminiMaxRpm()).toBe(10);
    setEnv("GEMINI_MAX_RPM", "15");
    expect(geminiMaxRpm()).toBe(15);
  });

  it("names the Jakarta clock when the daily quota is paused", () => {
    const until = new Date("2026-10-30T07:00:00Z");
    const now = new Date("2026-10-29T15:54:00Z");
    expect(formatGeminiPause(until, now)).toMatch(/^Kuota Gemini habis, lanjut otomatis pukul 14:00 WIB, 30 /);
    expect(formatGeminiPause(until, new Date("2026-10-30T06:00:00Z"))).toBe(
      "Kuota Gemini habis, lanjut otomatis pukul 14:00 WIB",
    );
  });

  it("spaces requests and holds every caller until a per-day pause ends", async () => {
    setEnv("GEMINI_MAX_RPM", "600");
    const sql = await createTestSql();
    const now = new Date("2026-10-29T16:00:00Z");
    const first = await acquireGeminiSlot(sql, now);
    const second = await acquireGeminiSlot(sql, now);
    expect(first).toEqual({ ok: true, waitMs: 0 });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.waitMs).toBe(100);
    }

    await recordGeminiPause(sql, now, 54_263_000, {
      perDay: true,
      kind: "day",
      metric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      limit: "500",
    });
    const pause = await readGeminiPause(sql, now);
    expect(pause?.perDay).toBe(true);
    expect(pause?.quotaLimit).toBe("500");
    expect(pause?.message).toMatch(/Kuota Gemini habis, lanjut otomatis pukul 14:04 WIB, 30 /);

    const blocked = await acquireGeminiSlot(sql, now);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.perDay).toBe(true);
      expect(blocked.retryAfterMs).toBe(54_263_000);
    }

    setEnv("GEMINI_API_KEY", "test-key");
    let calls = 0;
    const llm = new GeminiLlm(async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ candidates: [] }) };
    });
    await expect(
      withGeminiSql(sql, () => llm.complete({ purpose: "score", system: "", user: "" })),
    ).rejects.toMatchObject({ perDay: true, countsAsAttempt: false });
    expect(calls).toBe(0);
  });
});
