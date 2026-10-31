import { isSealedAccessToken, openAccessToken, sealAccessToken } from "../auth/token-cipher";
import type { Sql } from "../db/client";
import { TIME_ZONE } from "../domain/constants";
import { bearerInit, graphUrl, refreshAccessTokenUrl } from "./graph";

const DAY_MS = 24 * 60 * 60 * 1000;

export const ASSUMED_TOKEN_TTL_MS = 60 * DAY_MS;
export const IG_REFRESH_INTERVAL_MS = DAY_MS;
const REFRESH_MIN_AGE_MS = DAY_MS;
const REFRESH_WITHIN_MS = 30 * DAY_MS;
const EXPIRY_WARNING_MS = 7 * DAY_MS;

export const TOKEN_INVALID_STATUS = "Token tidak valid";
export const TOKEN_INVALID_DETAIL =
  "Token Instagram tidak valid. Tempel token long-lived dari Instagram Login.";
export const TOKEN_EXPIRED_DETAIL = "Token Instagram kedaluwarsa. Buat token long-lived baru.";
export const TOKEN_UNREACHABLE = "Tidak bisa menghubungi Instagram. Coba lagi.";
export const REFRESH_FAILED = "Pembaruan token Instagram gagal.";
export const TOKEN_UNREADABLE =
  "Token Instagram tidak bisa dibaca. Set TOKEN_ENCRYPTION_KEY atau CRON_SECRET.";

export type IgProfile = { userId: string; username: string };

type OauthKind = "invalid" | "expired";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function classifyOauth(body: unknown): OauthKind | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  if (body.error.code !== 190) return null;
  return body.error.error_subcode === 463 ? "expired" : "invalid";
}

function readProfile(body: unknown): IgProfile | null {
  if (!isRecord(body) || isRecord(body.error)) return null;
  const rawId = body.user_id ?? body.id;
  const userId = typeof rawId === "number" ? String(rawId) : typeof rawId === "string" ? rawId.trim() : "";
  let username = typeof body.username === "string" ? body.username.trim() : "";
  if (username.startsWith("@")) username = username.slice(1);
  if (!userId || !username) return null;
  return { userId, username };
}

/**
 * Read-only check against Instagram Login. Short-lived tokens cannot be exchanged
 * here: that call needs an app secret, so the pasted token must already be long-lived.
 */
export async function validateInstagramToken(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IgProfile> {
  const token = accessToken.trim();
  if (!token) throw new Error(TOKEN_INVALID_DETAIL);
  let res: Response;
  try {
    res = await fetchImpl(graphUrl("me", { fields: "user_id,username" }), bearerInit(token));
  } catch {
    throw new Error(TOKEN_UNREACHABLE);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const kind = classifyOauth(body);
    throw new Error(kind === "expired" ? TOKEN_EXPIRED_DETAIL : TOKEN_INVALID_DETAIL);
  }
  const profile = readProfile(body);
  if (!profile) throw new Error(TOKEN_INVALID_DETAIL);
  return profile;
}

export function formatCheckedAt(date: Date): string {
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour").padStart(2, "0");
  const minute = get("minute").padStart(2, "0");
  return `${get("day")} ${get("month")} ${get("year")}, ${hour}.${minute} WIB`;
}

export function describeInstagramConnection(input: {
  username: string | null;
  hasToken: boolean;
  checkedAt: Date | null;
  expiresAt: Date | null;
  tokenError: string | null;
  refreshError: string | null;
  now?: Date;
}): { status: string | null; warning: string | null; needsToken: boolean } {
  const now = input.now ?? new Date();
  if (!input.hasToken || !input.username) {
    return { status: null, warning: null, needsToken: true };
  }
  if (input.tokenError) {
    return { status: TOKEN_INVALID_STATUS, warning: null, needsToken: true };
  }
  const warning = input.refreshError ? REFRESH_FAILED : null;
  if (input.expiresAt) {
    const remaining = input.expiresAt.getTime() - now.getTime();
    if (remaining <= 0) {
      return { status: "Token kedaluwarsa", warning, needsToken: true };
    }
    if (remaining <= EXPIRY_WARNING_MS) {
      const days = Math.ceil(remaining / DAY_MS);
      return { status: `Token kedaluwarsa dalam ${days} hari`, warning, needsToken: false };
    }
  }
  const checked = input.checkedAt ? ` (dicek ${formatCheckedAt(input.checkedAt)})` : "";
  return {
    status: `Terhubung sebagai @${input.username}${checked}`,
    warning,
    needsToken: false,
  };
}

async function markRefreshFailed(sql: Sql): Promise<void> {
  await sql.rows(`update ig_connection set refresh_error = $1 where id = 1`, [REFRESH_FAILED]);
}

/** Daily refresh. No Meta call unless META_PROVIDER=meta, the token is at least 24h old, and it expires within 30 days. */
export async function refreshStoredInstagramToken(
  sql: Sql,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (process.env.META_PROVIDER !== "meta") return;
  const rows = await sql.rows<{
    access_token: string | null;
    expires_at: Date | string | null;
    refreshed_at: Date | string | null;
    connected_at: Date | string | null;
  }>(
    `select access_token, expires_at, refreshed_at, connected_at from ig_connection where id = 1`,
  );
  const row = rows[0];
  if (!row) return;
  const stored = row.access_token?.trim() ?? "";
  const token = openAccessToken(stored);
  if (!token) {
    if (isSealedAccessToken(stored)) {
      await sql.rows(`update ig_connection set refresh_error = $1 where id = 1`, [TOKEN_UNREADABLE]);
    }
    return;
  }
  const expiresAt = asDate(row.expires_at);
  if (!expiresAt) return;
  const ageAnchor = asDate(row.refreshed_at) ?? asDate(row.connected_at);
  if (!ageAnchor) return;
  if (now.getTime() - ageAnchor.getTime() < REFRESH_MIN_AGE_MS) return;
  if (expiresAt.getTime() - now.getTime() > REFRESH_WITHIN_MS) return;

  let res: Response;
  try {
    res = await fetchImpl(refreshAccessTokenUrl(), bearerInit(token));
  } catch {
    await markRefreshFailed(sql);
    return;
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const failure = classifyOauth(body);
  if (!res.ok || failure) {
    if (failure === "expired" || failure === "invalid") {
      await sql.rows(`update ig_connection set token_error = $1, refresh_error = $2 where id = 1`, [
        failure === "expired" ? TOKEN_EXPIRED_DETAIL : TOKEN_INVALID_DETAIL,
        REFRESH_FAILED,
      ]);
    } else {
      await markRefreshFailed(sql);
    }
    return;
  }
  if (!isRecord(body) || typeof body.access_token !== "string" || !body.access_token) {
    await markRefreshFailed(sql);
    return;
  }
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? body.expires_in
      : ASSUMED_TOKEN_TTL_MS / 1000;
  await sql.rows(
    `update ig_connection
     set access_token = $1, expires_at = $2, refreshed_at = $3, refresh_error = null, token_error = null
     where id = 1`,
    [sealAccessToken(body.access_token), new Date(now.getTime() + expiresIn * 1000), now],
  );
}
