import {
  acquireGeminiSlot,
  currentGeminiSql,
  geminiQuotaMessage,
  parseGeminiErrorBody,
  recordGeminiPause,
} from "./gemini-gate";

export type LlmRequest = { purpose: "score" | "copy"; system: string; user: string };

export type LlmResult = { text: string; costUsd: number; model: string };

export interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResult>;
}

function demoCopyPayload(user: string): Record<string, unknown> {
  const judulMatch = user.match(/^Judul: (.+)$/m);
  const sumberMatch = user.match(/^Sumber: (.+)$/m);
  const headline = judulMatch?.[1] ?? "Iklan baru bisa nyamar jadi fitur";
  const sourceName = sumberMatch?.[1] ?? "Contoh";
  return {
    slides: [
      { role: "cover", kicker: "AI", headline, body: "Satu kalimat pembuka." },
      { role: "point", kicker: "Fakta", headline: "Uji coba dibuka minggu ini", body: "Berlaku di beberapa akun." },
      { role: "point", kicker: "Dampak", headline: "Tim konten harus cek sumber", body: "Jangan bagikan ulang mentah." },
      {
        role: "cta",
        kicker: "Sumber",
        headline: "Baca lengkapnya di link bio",
        body: `Artikel asli ada di ${sourceName}.`,
      },
    ],
    caption: `Ringkasan dari ${sourceName}. Ini bukan artikel aslinya.`,
    hashtags: ["iklan", "medsos", "sumber"],
    altHeadlines: ["Fitur baru, atau iklan?", "Cek dulu sebelum dibagikan"],
  };
}

function demoScorePayload(user: string): Record<string, unknown> {
  const low = user.includes("FIXTURE:low");
  const sensitive = user.includes("FIXTURE:sensitive");
  const aspect = low ? 8 : 16;
  return {
    aspects: {
      relevansi: aspect,
      emosi: aspect,
      kebaruan: aspect,
      timing: aspect,
      shareability: aspect,
    },
    tags: ["marketing"],
    sensitive,
    sensitiveReason: sensitive ? "Topik sensitif (demo)" : null,
    blocked: user.includes("LARANGAN KERAS"),
    reason: low ? "Skor rendah (demo)" : "Layak untuk audiens marketing (demo)",
  };
}

export class DemoLlm implements LlmProvider {
  async complete(req: LlmRequest): Promise<LlmResult> {
    if (req.purpose === "score") {
      return {
        text: JSON.stringify(demoScorePayload(req.user)),
        costUsd: 0,
        model: "demo",
      };
    }
    return {
      text: JSON.stringify(demoCopyPayload(req.user)),
      costUsd: 0,
      model: "demo",
    };
  }
}

export class ScriptedLlm implements LlmProvider {
  private readonly responses: LlmResult[];

  constructor(responses: LlmResult[] | string[]) {
    this.responses = responses.map((r) =>
      typeof r === "string" ? { text: r, costUsd: 0, model: "scripted" } : r,
    );
  }

  async complete(_req: LlmRequest): Promise<LlmResult> {
    const next = this.responses.shift();
    if (!next) {
      throw new Error("ScriptedLlm exhausted");
    }
    return next;
  }
}

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

// Models page updated 2026-10-28: new projects should use gemini-3.5-flash-lite
// or gemini-3.8-flash. gemini-2.5-flash is still served, with access limited to
// accounts that already used the 2.5 family. Standard paid text rates below
// match gemini-3.5-flash-lite ($0.30 / $2.50 per 1M tokens).
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_DEFAULT_INPUT_USD_PER_MTOK = 0.3;
export const GEMINI_DEFAULT_OUTPUT_USD_PER_MTOK = 2.5;

export type LlmBanner = {
  provider: "demo" | "openai" | "gemini";
  model: string;
  text: string;
};

/** While a daily Gemini pause is in effect, the studio shows that pause instead of "AI aktif". */
export function studioModelLine(banner: string, pause: string | null): string | null {
  return pause ? null : banner;
}

export function llmBanner(): LlmBanner {
  const raw = process.env.LLM_PROVIDER ?? "demo";
  if (raw === "openai") {
    const model = process.env.OPENAI_MODEL ?? OPENAI_DEFAULT_MODEL;
    return {
      provider: "openai",
      model,
      text: `AI aktif: OpenAI, model ${model}.`,
    };
  }
  if (raw === "gemini") {
    const model = process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;
    return {
      provider: "gemini",
      model,
      text: `AI aktif: Gemini, model ${model}.`,
    };
  }
  return {
    provider: "demo",
    model: "demo",
    text: "AI demo: skor dan naskah dibuat lokal, tanpa biaya. Angka di header studio bertuliskan simulasi dan menunjukkan $0. Provider: demo, model: demo.",
  };
}

const SCORE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    aspects: {
      type: "OBJECT",
      properties: {
        relevansi: { type: "INTEGER" },
        emosi: { type: "INTEGER" },
        kebaruan: { type: "INTEGER" },
        timing: { type: "INTEGER" },
        shareability: { type: "INTEGER" },
      },
      required: ["relevansi", "emosi", "kebaruan", "timing", "shareability"],
    },
    tags: { type: "ARRAY", items: { type: "STRING" } },
    sensitive: { type: "BOOLEAN" },
    sensitiveReason: { type: "STRING", nullable: true },
    blocked: { type: "BOOLEAN" },
    reason: { type: "STRING" },
  },
  required: ["aspects", "tags", "sensitive", "sensitiveReason", "blocked", "reason"],
};

const COPY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    slides: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          role: { type: "STRING", enum: ["cover", "point", "cta"] },
          kicker: { type: "STRING" },
          headline: { type: "STRING" },
          body: { type: "STRING" },
        },
        required: ["role", "kicker", "headline", "body"],
      },
    },
    caption: { type: "STRING" },
    hashtags: { type: "ARRAY", items: { type: "STRING" } },
    altHeadlines: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["slides", "caption", "hashtags", "altHeadlines"],
};

export class LlmRateLimitError extends Error {
  readonly retryAfterMs: number;
  readonly countsAsAttempt: boolean;
  readonly perDay: boolean;
  readonly quotaId: string | null;
  readonly quotaMetric: string | null;
  readonly quotaLimit: string | null;
  readonly freeTier: boolean;

  constructor(
    retryAfterMs: number,
    message = "Gemini 429",
    options: {
      countsAsAttempt?: boolean;
      perDay?: boolean;
      quotaId?: string | null;
      quotaMetric?: string | null;
      quotaLimit?: string | null;
      freeTier?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "LlmRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.countsAsAttempt = options.countsAsAttempt ?? false;
    this.perDay = options.perDay ?? false;
    this.quotaId = options.quotaId ?? null;
    this.quotaMetric = options.quotaMetric ?? null;
    this.quotaLimit = options.quotaLimit ?? null;
    this.freeTier = options.freeTier ?? false;
  }
}

type GeminiResponse = {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json: () => Promise<unknown>;
};

type GeminiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<GeminiResponse>;

const GEMINI_TIMEOUT_MS = 20_000;

function headerRetryAfterMs(res: GeminiResponse): number | null {
  const header = res.headers?.get("retry-after") ?? res.headers?.get("Retry-After");
  if (header && /^\d+$/.test(header)) {
    return Number(header) * 1000;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class GeminiLlm implements LlmProvider {
  constructor(private readonly fetchImpl: GeminiFetch = (url, init) => fetch(url, init)) {}

  async complete(req: LlmRequest): Promise<LlmResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY missing");
    }
    const model = process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;
    const gate = currentGeminiSql();
    if (gate) {
      const slot = await acquireGeminiSlot(gate, new Date());
      if (!slot.ok) {
        throw new LlmRateLimitError(slot.retryAfterMs, slot.message, {
          countsAsAttempt: false,
          perDay: slot.perDay,
          quotaId: slot.quotaId,
          quotaMetric: slot.quotaMetric,
          quotaLimit: slot.quotaLimit,
        });
      }
      if (slot.waitMs > 0) {
        await sleep(slot.waitMs);
      }
    }
    let res: GeminiResponse;
    try {
      res = await this.fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: "user", parts: [{ text: req.user }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: req.purpose === "score" ? SCORE_RESPONSE_SCHEMA : COPY_RESPONSE_SCHEMA,
            },
          }),
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        },
      );
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new LlmRateLimitError(GEMINI_TIMEOUT_MS, "Gemini timeout", { countsAsAttempt: true });
      }
      throw error;
    }
    if (res.status === 429 || res.status === 503 || res.status === 504) {
      let parsed = parseGeminiErrorBody(null);
      if (res.status === 429) {
        try {
          parsed = parseGeminiErrorBody(await res.json());
        } catch {
          parsed = parseGeminiErrorBody(null);
        }
      }
      const retryAfterMs = parsed.retryAfterMs ?? headerRetryAfterMs(res) ?? (res.status === 429 ? 60_000 : GEMINI_TIMEOUT_MS);
      if (res.status === 429 && gate) {
        try {
          await recordGeminiPause(gate, new Date(), retryAfterMs, parsed);
        } catch {
          // The runner still defers this job if the gate row cannot be written.
        }
      }
      throw new LlmRateLimitError(retryAfterMs, geminiQuotaMessage(res.status, parsed), {
        countsAsAttempt: res.status !== 429,
        perDay: res.status === 429 && parsed.perDay,
        quotaId: parsed.quotaId,
        quotaMetric: parsed.metric,
        quotaLimit: parsed.limit,
        freeTier: parsed.freeTier,
      });
    }
    if (!res.ok) {
      throw new Error(`Gemini ${res.status}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    const inputRate = Number(
      process.env.GEMINI_INPUT_USD_PER_MTOK ?? String(GEMINI_DEFAULT_INPUT_USD_PER_MTOK),
    );
    const outputRate = Number(
      process.env.GEMINI_OUTPUT_USD_PER_MTOK ?? String(GEMINI_DEFAULT_OUTPUT_USD_PER_MTOK),
    );
    const usage = data.usageMetadata;
    let costUsd = 0;
    if (usage?.promptTokenCount != null && usage.candidatesTokenCount != null) {
      const outputTokens = usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0);
      costUsd = (usage.promptTokenCount * inputRate + outputTokens * outputRate) / 1_000_000;
    }
    return { text, costUsd, model };
  }
}

export class OpenAiLlm implements LlmProvider {
  async complete(req: LlmRequest): Promise<LlmResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY missing");
    }
    const model = process.env.OPENAI_MODEL ?? OPENAI_DEFAULT_MODEL;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const inputRate = Number(process.env.OPENAI_INPUT_USD_PER_MTOK ?? "0.15");
    const outputRate = Number(process.env.OPENAI_OUTPUT_USD_PER_MTOK ?? "0.60");
    let costUsd = 0;
    if (data.usage?.prompt_tokens != null && data.usage?.completion_tokens != null) {
      costUsd =
        (data.usage.prompt_tokens * inputRate + data.usage.completion_tokens * outputRate) /
        1_000_000;
    }
    return { text, costUsd, model };
  }
}

export function createLlm(): LlmProvider {
  if (process.env.LLM_PROVIDER === "openai") {
    return new OpenAiLlm();
  }
  if (process.env.LLM_PROVIDER === "gemini") {
    return new GeminiLlm();
  }
  return new DemoLlm();
}
