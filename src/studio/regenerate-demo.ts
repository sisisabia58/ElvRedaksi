import type { Sql } from "../db/client";
import { PLACEHOLDER_BODY } from "../domain/placeholder";
import { enqueue } from "../jobs/runner";
import { readGeminiPause } from "../llm/gemini-gate";

const DEMO_SCORE_REASON = "%(demo)";

export type DemoRewriteSnapshot = {
  demoScores: number;
  done: number;
  total: number;
};

// One read: leftover demo scores, rewritten copy, and the rewrite cohort.
// A Gemini retry used to leave jobs.error set, so a job counter stayed at the
// first-try successes even after the draft text had already changed.
export async function demoRewriteSnapshot(sql: Sql): Promise<DemoRewriteSnapshot> {
  const rows = await sql.rows<{ demo_scores: number; done: number; total: number }>(
    `with cohort as (
       select d.id, d.slides
       from drafts d
       where exists (
         select 1 from jobs j
         where j.name = 'copywriter.write'
           and coalesce(j.payload->>'regenerateDemo', '') = 'true'
           and j.payload->>'topicId' = d.topic_id::text
       )
     )
     select
       (
         select count(*)::int
         from drafts d
         join topics t on t.id = d.topic_id
         where d.status = 'needs_review'
           and position('(demo)' in coalesce(t.score_reason, '')) > 0
       ) as demo_scores,
       (select count(*)::int from cohort) as total,
       (
         select count(*)::int from cohort c
         where position($1 in c.slides::text) = 0
       ) as done`,
    [PLACEHOLDER_BODY],
  );
  const row = rows[0];
  return {
    demoScores: Number(row?.demo_scores ?? 0),
    done: Number(row?.done ?? 0),
    total: Number(row?.total ?? 0),
  };
}

export async function regenerateProgress(sql: Sql): Promise<{ done: number; total: number }> {
  const snapshot = await demoRewriteSnapshot(sql);
  return { done: snapshot.done, total: snapshot.total };
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

// The 66 rewrites that stopped after eight Gemini 429s. Still manual, and only
// drafts that are still waiting for a person. A later success, an open job, or
// any other error stays put.
export async function requeueStoppedGeminiRewrites(sql: Sql, now = new Date()): Promise<number> {
  const pause = await readGeminiPause(sql, now);
  const runAt = pause?.until ?? now;
  const rows = await sql.rows<{ topic_id: string }>(
    `select d.topic_id
     from drafts d
     where d.status = 'needs_review'
       and not exists (
         select 1 from jobs open_job
         where open_job.name = 'copywriter.write'
           and open_job.finished_at is null
           and coalesce(open_job.payload->>'regenerateDemo', '') = 'true'
           and open_job.payload->>'topicId' = d.topic_id::text
       )
       and exists (
         select 1 from jobs j
         where j.id = (
           select j2.id
           from jobs j2
           where j2.name = 'copywriter.write'
             and j2.finished_at is not null
             and coalesce(j2.payload->>'regenerateDemo', '') = 'true'
             and j2.payload->>'topicId' = d.topic_id::text
           order by j2.finished_at desc
           limit 1
         )
         and j.attempts >= 8
         and j.error like 'Gemini 429%'
       )`,
  );
  for (const row of rows) {
    await enqueue(sql, {
      name: "copywriter.write",
      payload: { topicId: row.topic_id, regenerateDemo: true },
      runAt,
      manual: true,
    });
  }
  return rows.length;
}

// Demo copy that has no open rewrite: the job failed, finished without
// replacing the stub, or was never created. One manual job per draft, parked
// until the Gemini pause lifts. A second call finds the open job and skips it.
export async function requeuePlaceholderRewrites(sql: Sql, now = new Date()): Promise<number> {
  const pause = await readGeminiPause(sql, now);
  const runAt = pause?.until && pause.until.getTime() > now.getTime() ? pause.until : now;
  const rows = await sql.rows<{ topic_id: string }>(
    `select d.topic_id
     from drafts d
     where d.status = 'needs_review'
       and position($1 in d.slides::text) > 0
       and not exists (
         select 1 from jobs j
         where j.name = 'copywriter.write'
           and j.finished_at is null
           and j.payload->>'topicId' = d.topic_id::text
       )`,
    [PLACEHOLDER_BODY],
  );
  for (const row of rows) {
    await enqueue(sql, {
      name: "copywriter.write",
      payload: { topicId: row.topic_id, regenerateDemo: true },
      runAt,
      manual: true,
    });
  }
  return rows.length;
}
