import type { Sql } from "../db/client";
import { enqueue } from "../jobs/runner";

const DEMO_SCORE_REASON = "%(demo)";

export async function regenerateProgress(sql: Sql): Promise<{ done: number; total: number }> {
  const rows = await sql.rows<{ total: string; done: string }>(
    `select
       (count(*) filter (where coalesce(payload->>'regenerateDemo', '') = 'true'))::int as total,
       (count(*) filter (
         where coalesce(payload->>'regenerateDemo', '') = 'true'
           and finished_at is not null
           and coalesce(error, '') = ''
       ))::int as done
     from jobs`,
  );
  return { done: Number(rows[0]?.done ?? 0), total: Number(rows[0]?.total ?? 0) };
}

export async function countDemoReviewDrafts(sql: Sql): Promise<number> {
  const rows = await sql.rows<{ count: string }>(
    `select count(*)::int as count
     from drafts d
     join topics t on t.id = d.topic_id
     where d.status = 'needs_review'
       and t.score_reason like $1`,
    [DEMO_SCORE_REASON],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function enqueueDemoRegeneration(sql: Sql, now = new Date()): Promise<number> {
  const rows = await sql.rows<{ topic_id: string }>(
    `select d.topic_id
     from drafts d
     join topics t on t.id = d.topic_id
     where d.status = 'needs_review'
       and t.score_reason like $1
       and not exists (
         select 1 from jobs j
         where j.name = 'copywriter.write'
           and j.finished_at is null
           and j.payload->>'topicId' = d.topic_id::text
           and coalesce(j.payload->>'regenerateDemo', '') = 'true'
       )`,
    [DEMO_SCORE_REASON],
  );
  for (const row of rows) {
    await enqueue(sql, {
      name: "copywriter.write",
      payload: { topicId: row.topic_id, regenerateDemo: true },
      runAt: now,
      manual: true,
    });
  }
  return rows.length;
}
