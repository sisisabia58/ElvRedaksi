import { can, type Role } from "../auth/rbac";
import { isSealedAccessToken, openAccessToken } from "../auth/token-cipher";
import type { Sql } from "../db/client";

export const PRACTICE_LOCKED = "Mode latihan dikunci oleh server.";
export const PUBLISH_DISCONNECTED = "Instagram belum terhubung";
export const TOKEN_UNREADABLE_PUBLISH =
  "Token Instagram tidak bisa dibaca. Set TOKEN_ENCRYPTION_KEY atau CRON_SECRET.";

/** META_PROVIDER=fake, or any value other than unset/"meta", forces practice mode. */
export function envForcesPractice(): boolean {
  const raw = process.env.META_PROVIDER?.trim() ?? "";
  return raw !== "" && raw !== "meta";
}

export function isPracticeMode(stored: boolean | null | undefined): boolean {
  if (envForcesPractice()) return true;
  return stored !== false;
}

export function practiceBanner(input: {
  practice: boolean;
  envLocked: boolean;
  username: string | null;
}): string {
  if (input.practice && input.envLocked) {
    return "Mode latihan: posting tidak dikirim ke Instagram. Dikunci oleh server.";
  }
  if (input.practice) {
    return "Mode latihan: posting tidak dikirim ke Instagram.";
  }
  const account = input.username?.trim().replace(/^@/, "") ?? "";
  if (account) return `Mode siaran: posting dikirim ke @${account}.`;
  return "Mode siaran: akun Instagram belum terhubung. Posting diblokir.";
}

export async function readPracticeMode(sql: Sql): Promise<boolean> {
  const rows = await sql.rows<{ practice_mode: boolean | null }>(
    "select practice_mode from brand where id = 1",
  );
  return isPracticeMode(rows[0]?.practice_mode);
}

export async function setPracticeMode(sql: Sql, role: Role, enabled: boolean): Promise<void> {
  if (!can(role, "settings.write")) {
    throw new Error("forbidden");
  }
  if (!enabled && envForcesPractice()) {
    throw new Error(PRACTICE_LOCKED);
  }
  const existing = await sql.rows<{ id: number }>("select id from brand where id = 1");
  if (existing.length === 0) {
    await sql.rows(
      `insert into brand (id, name, handle, initial, accent, kicker, practice_mode)
       values (1, 'Analyst Digest', '', 'A', '#4E708C', 'Catatan redaksi', $1)`,
      [enabled],
    );
    return;
  }
  await sql.rows("update brand set practice_mode = $1 where id = 1", [enabled]);
}

/** Why a live publish must stop, or null while practice mode is on or the connection is usable. */
export async function livePublishBlock(sql: Sql): Promise<string | null> {
  if (await readPracticeMode(sql)) return null;
  const rows = await sql.rows<{
    ig_user_id: string | null;
    access_token: string | null;
    token_error: string | null;
  }>("select ig_user_id, access_token, token_error from ig_connection where id = 1");
  const row = rows[0];
  const stored = row?.access_token?.trim() ?? "";
  const token = openAccessToken(stored);
  const igUserId = row?.ig_user_id?.trim() ?? "";
  if (!token || !igUserId) {
    return isSealedAccessToken(stored) ? TOKEN_UNREADABLE_PUBLISH : PUBLISH_DISCONNECTED;
  }
  if (row?.token_error) return row.token_error;
  return null;
}
