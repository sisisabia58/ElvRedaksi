import { can, type Role } from "../auth/rbac";
import type { Sql } from "../db/client";
import { enqueue } from "../jobs/runner";

export async function queueBeritaProRerender(sql: Sql, role: Role): Promise<number> {
  if (!can(role, "settings.write")) {
    throw new Error("forbidden");
  }
  const rows = await sql.rows<{ id: string }>(
    `update drafts
     set template = 'berita_pro', text_dirty = true, updated_at = now()
     where status = 'needs_review'
     returning id`,
  );
  for (const row of rows) {
    const open = await sql.rows<{ id: string }>(
      `select id from jobs
       where name = 'designer.render' and finished_at is null and payload->>'draftId' = $1
       limit 1`,
      [row.id],
    );
    if (open.length > 0) {
      continue;
    }
    await enqueue(sql, {
      name: "designer.render",
      payload: { draftId: row.id },
      runAt: new Date(),
      manual: true,
    });
  }
  return rows.length;
}
