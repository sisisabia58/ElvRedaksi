import type { Sql } from "../db/client";
import { TIME_ZONE } from "../domain/constants";

export type Funnel = {
  arrived24h: number;
  waitingScore: number;
  passed24h: number;
  waitingDraft: number;
  needsReview: number;
  scheduled: number;
  postedThisWeek: number;
};

export async function funnelCounts(sql: Sql, now: Date = new Date()): Promise<Funnel> {
  const rows = await sql.rows<{
    arrived24h: string;
    waiting_score: string;
    passed24h: string;
    waiting_draft: string;
    needs_review: string;
    scheduled: string;
    posted_this_week: string;
  }>(
    `select
       (select count(*)::int from topics where discovered_at > ($1::timestamptz - interval '24 hours')) as arrived24h,
       (select count(*)::int from topics where state = 'new') as waiting_score,
       (select count(*)::int from topics where state = 'passed' and scored_at > ($1::timestamptz - interval '24 hours')) as passed24h,
       (select count(*)::int from topics where state = 'passed') as waiting_draft,
       (select count(*)::int from drafts where status = 'needs_review') as needs_review,
       (select count(*)::int from drafts where status = 'scheduled') as scheduled,
       (select count(*)::int from drafts
         where status = 'posted'
           and posted_at is not null
           and (posted_at at time zone '${TIME_ZONE}') >= date_trunc('week', ($1::timestamptz at time zone '${TIME_ZONE}'))
           and (posted_at at time zone '${TIME_ZONE}') < date_trunc('week', ($1::timestamptz at time zone '${TIME_ZONE}')) + interval '7 days') as posted_this_week`,
    [now],
  );
  const row = rows[0];
  return {
    arrived24h: Number(row?.arrived24h ?? 0),
    waitingScore: Number(row?.waiting_score ?? 0),
    passed24h: Number(row?.passed24h ?? 0),
    waitingDraft: Number(row?.waiting_draft ?? 0),
    needsReview: Number(row?.needs_review ?? 0),
    scheduled: Number(row?.scheduled ?? 0),
    postedThisWeek: Number(row?.posted_this_week ?? 0),
  };
}
