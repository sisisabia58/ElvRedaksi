import { randomUUID } from "node:crypto";
import { z } from "zod";
import { can, type Role } from "../auth/rbac";
import type { Sql } from "../db/client";

export type SourceRow = {
  id: string;
  name: string;
  url: string;
  lang: "ID" | "EN";
  enabled: boolean;
  topicCount: number;
  passCount7d: number;
  lastFetchedAt: Date | null;
  lastError: string | null;
};

const sourceInputSchema = z.object({
  name: z.string().min(2, "Nama 2–80 karakter.").max(80, "Nama 2–80 karakter."),
  url: z
    .string()
    .url("URL tidak valid.")
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }, "URL harus http atau https."),
  lang: z.enum(["ID", "EN"]),
});

function requireSourceWrite(role: Role): void {
  if (!can(role, "source.write")) {
    throw new Error("forbidden");
  }
}

export async function addSource(
  sql: Sql,
  role: Role,
  input: { name: string; url: string; lang: "ID" | "EN" },
): Promise<void> {
  requireSourceWrite(role);
  const parsed = sourceInputSchema.parse(input);
  await sql.rows(
    `insert into sources (id, name, url, lang) values ($1, $2, $3, $4)`,
    [randomUUID(), parsed.name.trim(), parsed.url.trim(), parsed.lang],
  );
}

export async function setSourceEnabled(
  sql: Sql,
  role: Role,
  id: string,
  enabled: boolean,
): Promise<void> {
  requireSourceWrite(role);
  await sql.rows(`update sources set enabled = $1 where id = $2`, [enabled, id]);
}

export async function deleteSource(sql: Sql, role: Role, id: string): Promise<void> {
  requireSourceWrite(role);
  await sql.tx(async (tx) => {
    await tx.rows(
      `delete from drafts where topic_id in (select id from topics where source_id = $1)`,
      [id],
    );
    await tx.rows(`delete from sources where id = $1`, [id]);
  });
}

export async function listSources(sql: Sql): Promise<SourceRow[]> {
  const rows = await sql.rows<{
    id: string;
    name: string;
    url: string;
    lang: "ID" | "EN";
    enabled: boolean;
    last_fetched_at: Date | null;
    last_error: string | null;
    topic_count: number;
    pass_count_7d: number;
  }>(
    `select s.id, s.name, s.url, s.lang, s.enabled, s.last_fetched_at, s.last_error,
            (select count(*)::int from topics t where t.source_id = s.id) as topic_count,
            (select count(*)::int from topics t
               where t.source_id = s.id
                 and t.state = 'passed'
                 and t.scored_at > now() - interval '7 days') as pass_count_7d
     from sources s
     order by s.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    lang: row.lang,
    enabled: row.enabled,
    topicCount: Number(row.topic_count),
    passCount7d: Number(row.pass_count_7d),
    lastFetchedAt: row.last_fetched_at ? new Date(row.last_fetched_at) : null,
    lastError: row.last_error,
  }));
}
