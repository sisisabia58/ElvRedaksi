import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Sql } from "../db/client";
import type { Role } from "./rbac";

export const SESSION_COOKIE = "redaksi_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  sql: Sql,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await sql.rows(
    "insert into sessions (id, user_id, token_hash, expires_at) values ($1,$2,$3,$4)",
    [randomUUID(), userId, tokenHash(token), expiresAt],
  );
  return { token, expiresAt };
}

export async function userForToken(
  sql: Sql,
  token: string,
): Promise<{ id: string; name: string; role: Role } | null> {
  const rows = await sql.rows<{ id: string; name: string; role: Role }>(
    `select u.id, u.name, u.role
     from users u
     join sessions s on s.user_id = u.id
     where s.token_hash = $1 and s.expires_at > now()`,
    [tokenHash(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSessionForToken(sql: Sql, token: string): Promise<void> {
  await sql.rows("delete from sessions where token_hash = $1", [tokenHash(token)]);
}
