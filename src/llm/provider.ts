export type LlmRequest = { purpose: "score" | "copy"; system: string; user: string };

export type LlmResult = { text: string; costUsd: number; model: string };

export interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResult>;
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
        costUsd: 0.002,
        model: "demo",
      };
    }
    return { text: "{}", costUsd: 0.01, model: "demo" };
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

export class OpenAiLlm implements LlmProvider {
  async complete(req: LlmRequest): Promise<LlmResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY missing");
    }
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
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
  return new DemoLlm();
}
