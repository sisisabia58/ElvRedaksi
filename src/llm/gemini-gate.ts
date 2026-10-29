import { AsyncLocalStorage } from "node:async_hooks";
import type { Sql } from "../db/client";
import { TIME_ZONE } from "../domain/constants";

// Free-tier gemini-3.5-flash-lite is 15 requests per minute in published
// measurements. This default stays under that so a cron burst does not trip
// the minute window. The daily cap is whatever the 429 quotaValue names.
export const GEMINI_DEFAULT_MAX_RPM = 10;

const geminiSql = new AsyncLocalStorage<Sql>();

export function withGeminiSql<T>(sql: Sql, fn: () => Promise<T>): Promise<T> {
  return geminiSql.run(sql, fn);
}

export function currentGeminiSql(): Sql | null {
  return geminiSql.getStore() ?? null;
}

export function geminiMaxRpm(): number {
  const raw = Number(process.env.GEMINI_MAX_RPM);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 600) {
    return Math.floor(raw);
  }
  return GEMINI_DEFAULT_MAX_RPM;
}

export type GeminiQuotaKind = "day" | "minute" | "tokens" | "unknown";

export type ParsedGeminiError = {
  retryAfterMs: number | null;
  kind: GeminiQuotaKind;
  perDay: boolean;
  freeTier: boolean;
  metric: string | null;
  quotaId: string | null;
  limit: string | null;
};

type QuotaViolation = {
  quotaMetric?: string;
  quotaId?: string;
  quotaValue?: string;
};

type ErrorDetail = {
  "@type"?: string;
  retryDelay?: string;
  violations?: QuotaViolation[];
};

export function parseRetryDelay(raw: string): number | null {
  const value = raw.trim();
  const secondsOnly = /^(\d+(?:\.\d+)?)s$/.exec(value);
  if (secondsOnly) {
    const ms = Number(secondsOnly[1]) * 1000;
    return ms > 0 ? Math.ceil(ms) : null;
  }
  const clock = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(value);
  if (!clock || (clock[1] == null && clock[2] == null && clock[3] == null)) {
    return null;
  }
  const ms =
    (Number(clock[1] ?? 0) * 3600 + Number(clock[2] ?? 0) * 60 + Number(clock[3] ?? 0)) * 1000;
  return ms > 0 ? Math.ceil(ms) : null;
}

function kindFromNames(quotaId: string, metric: string, message: string): GeminiQuotaKind {
  const blob = `${quotaId} ${metric} ${message}`.toLowerCase();
  if (blob.includes("perday") || blob.includes("per_day") || blob.includes("per day")) {
    return "day";
  }
  if (blob.includes("token")) {
    return "tokens";
  }
  if (blob.includes("perminute") || blob.includes("per_minute") || blob.includes("per minute")) {
    return "minute";
  }
  return "unknown";
}

function retryFromMessage(message: string): number | null {
  const match = /retry in ([0-9.]+(?:h[0-9.]+)?(?:m[0-9.]+)?s)/i.exec(message);
  if (!match?.[1]) {
    return null;
  }
  return parseRetryDelay(match[1]);
}

export function parseGeminiErrorBody(body: unknown): ParsedGeminiError {
  const error =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { message?: string; details?: ErrorDetail[] } }).error
      : undefined;
  const message = typeof error?.message === "string" ? error.message : "";
  const details = Array.isArray(error?.details) ? error.details : [];
  let retryAfterMs: number | null = null;
  const violations: QuotaViolation[] = [];
  for (const detail of details) {
    if (typeof detail?.retryDelay === "string") {
      retryAfterMs = parseRetryDelay(detail.retryDelay) ?? retryAfterMs;
    }
    if (Array.isArray(detail?.violations)) {
      violations.push(...detail.violations);
    }
  }
  if (retryAfterMs == null) {
    retryAfterMs = retryFromMessage(message);
  }
  const preferred =
    violations.find((item) => kindFromNames(item.quotaId ?? "", item.quotaMetric ?? "", message) === "day") ??
    violations[0];
  const quotaId = preferred?.quotaId ?? null;
  const metric = preferred?.quotaMetric ?? null;
  const limit = preferred?.quotaValue ?? null;
  const kind = kindFromNames(quotaId ?? "", metric ?? "", message);
  const blob = `${quotaId ?? ""} ${metric ?? ""} ${message}`.toLowerCase();
  const freeTier = blob.includes("freetier") || blob.includes("free tier");
  const longWait = (retryAfterMs ?? 0) >= 30 * 60_000;
  const perDay = kind === "day" || (longWait && kind !== "minute" && kind !== "tokens");
  return { retryAfterMs, kind: perDay ? "day" : kind, perDay, freeTier, metric, quotaId, limit };
}

export function geminiQuotaMessage(status: number, parsed: ParsedGeminiError): string {
  if (status !== 429) {
    return `Gemini ${status}`;
  }
  if (parsed.quotaId && parsed.limit) {
    const metric = parsed.metric && parsed.metric !== parsed.quotaId ? `${parsed.metric} ` : "";
    return `Gemini 429: ${metric}limit ${parsed.limit} (${parsed.quotaId})`;
  }
  return "Gemini 429";
}

function clockInZone(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatGeminiPause(until: Date, now = new Date()): string {
  const time = clockInZone(until);
  if (dayKey(until) === dayKey(now)) {
    return `Kuota Gemini habis, lanjut otomatis pukul ${time} WIB`;
  }
  const date = new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
  }).format(until);
  return `Kuota Gemini habis, lanjut otomatis pukul ${time} WIB, ${date}`;
}

type GateRow = {
  paused_until: Date | string | null;
  pause_kind: string | null;
  quota_metric: string | null;
  quota_id: string | null;
  quota_limit: string | null;
  last_request_at: Date | string | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type GeminiPause = {
  until: Date;
  perDay: boolean;
  message: string;
  quotaId: string | null;
  quotaMetric: string | null;
  quotaLimit: string | null;
};

export async function readGeminiPause(sql: Sql, now = new Date()): Promise<GeminiPause | null> {
  let rows: GateRow[];
  try {
    rows = await sql.rows<GateRow>(
      `select paused_until, pause_kind, quota_metric, quota_id, quota_limit, last_request_at
       from gemini_gate where id = 1`,
    );
  } catch {
    return null;
  }
  const until = asDate(rows[0]?.paused_until);
  if (!until || until.getTime() <= now.getTime()) {
    return null;
  }
  const perDay = rows[0]?.pause_kind === "day";
  return {
    until,
    perDay,
    message: perDay
      ? formatGeminiPause(until, now)
      : `Gemini dibatasi, lanjut otomatis pukul ${clockInZone(until)} WIB`,
    quotaId: rows[0]?.quota_id ?? null,
    quotaMetric: rows[0]?.quota_metric ?? null,
    quotaLimit: rows[0]?.quota_limit ?? null,
  };
}

export async function recordGeminiPause(
  sql: Sql,
  now: Date,
  retryAfterMs: number,
  info: {
    perDay: boolean;
    kind?: GeminiQuotaKind;
    metric?: string | null;
    quotaId?: string | null;
    limit?: string | null;
  },
): Promise<void> {
  const until = new Date(now.getTime() + Math.max(0, retryAfterMs));
  const kind = info.perDay ? "day" : (info.kind ?? "unknown");
  await sql.rows(
    `insert into gemini_gate (id, paused_until, pause_kind, quota_metric, quota_id, quota_limit)
     values (1, $1, $2, $3, $4, $5)
     on conflict (id) do update set
       paused_until = excluded.paused_until,
       pause_kind = excluded.pause_kind,
       quota_metric = excluded.quota_metric,
       quota_id = excluded.quota_id,
       quota_limit = excluded.quota_limit
     where gemini_gate.paused_until is null or gemini_gate.paused_until < excluded.paused_until`,
    [until, kind, info.metric ?? null, info.quotaId ?? null, info.limit ?? null],
  );
}

export type GeminiSlot =
  | { ok: true; waitMs: number }
  | {
      ok: false;
      retryAfterMs: number;
      perDay: boolean;
      message: string;
      quotaId: string | null;
      quotaMetric: string | null;
      quotaLimit: string | null;
    };

const SPACING_SLEEP_CAP_MS = 60_000;

export async function acquireGeminiSlot(sql: Sql, now = new Date()): Promise<GeminiSlot> {
  return sql.tx(async (tx) => {
    let rows = await tx.rows<GateRow>(
      `select paused_until, pause_kind, quota_metric, quota_id, quota_limit, last_request_at
       from gemini_gate where id = 1 for update`,
    );
    if (!rows[0]) {
      await tx.rows(`insert into gemini_gate (id) values (1) on conflict (id) do nothing`);
      rows = await tx.rows<GateRow>(
        `select paused_until, pause_kind, quota_metric, quota_id, quota_limit, last_request_at
         from gemini_gate where id = 1 for update`,
      );
    }
    const row = rows[0];
    const pausedUntil = asDate(row?.paused_until);
    if (pausedUntil && pausedUntil.getTime() > now.getTime()) {
      const perDay = row?.pause_kind === "day";
      return {
        ok: false,
        retryAfterMs: pausedUntil.getTime() - now.getTime(),
        perDay,
        message: perDay
          ? formatGeminiPause(pausedUntil, now)
          : `Gemini dibatasi, lanjut otomatis pukul ${clockInZone(pausedUntil)} WIB`,
        quotaId: row?.quota_id ?? null,
        quotaMetric: row?.quota_metric ?? null,
        quotaLimit: row?.quota_limit ?? null,
      };
    }
    const interval = Math.ceil(60_000 / geminiMaxRpm());
    const last = asDate(row?.last_request_at)?.getTime() ?? 0;
    const earliest = last > 0 ? last + interval : now.getTime();
    const waitMs = Math.max(0, earliest - now.getTime());
    if (waitMs > SPACING_SLEEP_CAP_MS) {
      return {
        ok: false,
        retryAfterMs: waitMs,
        perDay: false,
        message: "Gemini menunggu jeda kuota per menit",
        quotaId: null,
        quotaMetric: null,
        quotaLimit: null,
      };
    }
    await tx.rows(`update gemini_gate set last_request_at = $1 where id = 1`, [
      new Date(now.getTime() + waitMs),
    ]);
    return { ok: true, waitMs };
  });
}
