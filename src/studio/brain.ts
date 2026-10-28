import { randomBytes } from "node:crypto";
import { can, type Role } from "../auth/rbac";
import type { Sql } from "../db/client";

export async function listBrain(
  sql: Sql,
): Promise<{ slug: string; title: string; body: string; locked: boolean; updatedAt: Date }[]> {
  const rows = await sql.rows<{
    slug: string;
    title: string;
    body: string;
    locked: boolean;
    updated_at: Date;
  }>("select slug, title, body, locked, updated_at from brain_docs order by slug");
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    body: row.body,
    locked: row.locked,
    updatedAt: row.updated_at,
  }));
}

export async function saveBrain(
  sql: Sql,
  role: Role,
  input: { slug: string; body: string },
): Promise<void> {
  if (!can(role, "brain.write")) {
    throw new Error("forbidden");
  }
  const body = input.body.trim();
  if (!body) {
    throw new Error("Catatan kosong");
  }
  await sql.rows("update brain_docs set body = $1, updated_at = now() where slug = $2", [
    body,
    input.slug,
  ]);
}

export async function createNote(sql: Sql, role: Role, title: string): Promise<{ slug: string }> {
  if (!can(role, "brain.write")) {
    throw new Error("forbidden");
  }
  const trimmedTitle = title.trim().slice(0, 80);
  const slug = `catatan-${randomBytes(3).toString("hex")}`;
  await sql.rows(
    "insert into brain_docs (slug, title, body, locked) values ($1, $2, $3, false)",
    [slug, trimmedTitle, ""],
  );
  return { slug };
}

export async function deleteNote(sql: Sql, role: Role, slug: string): Promise<void> {
  if (!can(role, "brain.write")) {
    throw new Error("forbidden");
  }
  const rows = await sql.rows<{ locked: boolean }>(
    "select locked from brain_docs where slug = $1",
    [slug],
  );
  if (rows[0]?.locked) {
    throw new Error("Dokumen terkunci");
  }
  await sql.rows("delete from brain_docs where slug = $1", [slug]);
}
