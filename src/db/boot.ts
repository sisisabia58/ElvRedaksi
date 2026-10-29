import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth/password";
import { enqueue, type JobName } from "../jobs/runner";
import type { Sql } from "./client";
import { seedDefaults } from "./seed";
import { DDL } from "./sql";

const DEMO_EMAIL = "admin@redaksi.local";
const DEMO_PASSWORD = "redaksi-dev-only";

const BOOT_JOBS: JobName[] = ["scout.scan", "insights.sync"];

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

export async function applyDdl(sql: Sql): Promise<void> {
  const statements = DDL.split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    const text = statement.endsWith(";") ? statement : `${statement};`;
    await sql.rows(text);
  }
}

async function seedDemoAdmin(sql: Sql): Promise<void> {
  // The known demo password stays off production even if SEED_DEMO=1 is still set.
  if (process.env.SEED_DEMO !== "1" || process.env.NODE_ENV === "production") {
    return;
  }
  const existing = await sql.rows<{ id: string }>("select id from users where lower(email) = $1", [
    DEMO_EMAIL,
  ]);
  if (existing.length > 0) {
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  try {
    await sql.rows(
      "insert into users (id, name, email, password_hash, role) values ($1, $2, $3, $4, $5)",
      [randomUUID(), "Admin", DEMO_EMAIL, passwordHash, "admin"],
    );
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }
}

async function enqueueIfUnfinished(sql: Sql, name: JobName): Promise<void> {
  await sql.tx(async (tx) => {
    const open = await tx.rows<{ id: string }>(
      "select id from jobs where name = $1 and finished_at is null limit 1",
      [name],
    );
    if (open.length > 0) {
      return;
    }
    await enqueue(tx, { name, payload: {}, runAt: new Date(), manual: false });
  });
}

export async function boot(sql: Sql): Promise<void> {
  await applyDdl(sql);
  await seedDefaults(sql);
  await seedDemoAdmin(sql);
  for (const name of BOOT_JOBS) {
    await enqueueIfUnfinished(sql, name);
  }
}
