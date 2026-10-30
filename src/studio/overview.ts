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

export function overviewStatusChip(input: {
  awake: boolean;
  workStart: string;
  workEnd: string;
  geminiPause: string | null;
}): string {
  if (input.geminiPause) {
    return input.geminiPause;
  }
  return `${input.awake ? "AI aktif" : "AI tidur"} · jam kerja ${input.workStart}–${input.workEnd} WIB`;
}

export type NewsroomQueues = {
  rewriteQueue: number;
  renderOpen: number;
  renderDone: number;
  reviewDrafts: number;
};

export function rewriteQueueLabel(count: number): string {
  return `${count} antre tulis ulang`;
}

export function renderProgressLabel(done: number, total: number, open: number): string {
  const base = `${done} dari ${total} gambar selesai`;
  return open > 0 ? `${base} · ${open} dalam antrian` : base;
}

export async function newsroomQueues(sql: Sql): Promise<NewsroomQueues> {
  const rows = await sql.rows<{
    rewrite_queue: string;
    render_open: string;
    review_drafts: string;
    render_dirty: string;
  }>(
    `select
       (select count(*)::int from jobs where name = 'copywriter.write' and finished_at is null) as rewrite_queue,
       (select count(*)::int from jobs where name = 'designer.render' and finished_at is null) as render_open,
       (select count(*)::int from drafts where status = 'needs_review') as review_drafts,
       (select count(*)::int from drafts where status = 'needs_review' and text_dirty) as render_dirty`,
  );
  const row = rows[0];
  const reviewDrafts = Number(row?.review_drafts ?? 0);
  const renderDirty = Number(row?.render_dirty ?? 0);
  return {
    rewriteQueue: Number(row?.rewrite_queue ?? 0),
    renderOpen: Number(row?.render_open ?? 0),
    renderDone: Math.max(0, reviewDrafts - renderDirty),
    reviewDrafts,
  };
}

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

export type AgentId = "scout" | "analis" | "copywriter" | "designer";

export type AgentCard = {
  agent: AgentId;
  role: string;
  lastAt: Date | null;
  running: boolean;
};

const AGENTS: { agent: AgentId; role: string; jobPrefix: string }[] = [
  { agent: "scout", role: "Pemantau topik", jobPrefix: "scout." },
  // Activity and the card id say "analis"; the job name is analyst.score.
  { agent: "analis", role: "Cek potensi viral", jobPrefix: "analyst." },
  { agent: "copywriter", role: "Headline & caption", jobPrefix: "copywriter." },
  { agent: "designer", role: "Render gambar", jobPrefix: "designer." },
];

export async function agentCards(sql: Sql, now: Date): Promise<AgentCard[]> {
  const [jobs, activity] = await Promise.all([
    sql.rows<{ name: string }>(
      "select name from jobs where locked_at is not null and finished_at is null",
    ),
    sql.rows<{ agent: string; last_at: Date | string | null }>(
      `select agent, max(created_at) as last_at
       from activity
       group by agent`,
    ),
  ]);
  const lastByAgent = new Map(
    activity.flatMap((row) => {
      if (row.last_at == null) return [];
      const at = new Date(row.last_at);
      const lastAt = at.getTime() > now.getTime() ? now : at;
      return [[row.agent, lastAt] as const];
    }),
  );
  return AGENTS.map((spec) => ({
    agent: spec.agent,
    role: spec.role,
    lastAt: lastByAgent.get(spec.agent) ?? null,
    running: jobs.some((job) => job.name.startsWith(spec.jobPrefix)),
  }));
}

export async function recentActivity(sql: Sql): Promise<{ agent: string; message: string; at: Date }[]> {
  const rows = await sql.rows<{ agent: string; message: string; created_at: Date | string }>(
    `select agent, message, created_at
     from activity
     order by created_at desc
     limit 8`,
  );
  return rows.map((row) => ({
    agent: row.agent,
    message: row.message,
    at: new Date(row.created_at),
  }));
}
