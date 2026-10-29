import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../auth/password";
import { can, ROLES, type Role } from "../auth/rbac";
import type { Sql } from "../db/client";

const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type TeamUser = {
  name: string;
  email: string;
  role: Role;
  lastLoginAt: Date | null;
};

function requireTeamWrite(role: Role): void {
  if (!can(role, "team.write")) {
    throw new Error("forbidden");
  }
}

function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Email tidak valid");
  }
  return email;
}

function temporaryPassword(): string {
  const bytes = randomBytes(16);
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return password;
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /duplicate key|unique constraint/i.test(message);
}

export async function inviteUser(
  sql: Sql,
  actorRole: Role,
  input: { name: string; email: string; role: Role },
): Promise<{ password: string }> {
  requireTeamWrite(actorRole);
  const name = input.name.trim();
  if (!name) {
    throw new Error("Nama wajib diisi");
  }
  if (!isRole(input.role)) {
    throw new Error("Peran tidak valid");
  }
  const email = normalizeEmail(input.email);
  const existing = await sql.rows<{ id: string }>("select id from users where lower(email) = $1", [
    email,
  ]);
  if (existing.length > 0) {
    throw new Error("Email sudah dipakai");
  }
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  try {
    await sql.rows(
      "insert into users (id, name, email, password_hash, role) values ($1, $2, $3, $4, $5)",
      [randomUUID(), name, email, passwordHash, input.role],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Email sudah dipakai");
    }
    throw error;
  }
  return { password };
}

export async function listUsers(sql: Sql): Promise<TeamUser[]> {
  const rows = await sql.rows<{
    name: string;
    email: string;
    role: Role;
    last_login_at: Date | string | null;
  }>("select name, email, role, last_login_at from users order by created_at");
  return rows.map((row) => ({
    name: row.name,
    email: row.email,
    role: row.role,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
  }));
}
