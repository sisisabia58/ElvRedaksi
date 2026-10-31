import { randomUUID } from "node:crypto";
import type { Sql } from "../db/client";
import { TIME_ZONE } from "../domain/constants";
import { isWithinWorkHours } from "../domain/time";
import { readGeminiPause, recordGeminiPause, withGeminiSql } from "../llm/gemini-gate";
import { LlmRateLimitError } from "../llm/provider";

export type JobName =
  | "scout.scan"
  | "analyst.score"
  | "copywriter.write"
  | "designer.render"
  | "publisher.publish"
  | "insights.sync"
  | "ig.refresh";

export type JobCtx = {
  sql: Sql;
  payload: Record<string, unknown>;
  manual: boolean;
  now: Date;
  attempts?: number;
  reclaimed?: boolean;
};

export type JobDeps = {
  handlers: Record<JobName, (ctx: JobCtx) => Promise<void>>;
  workStart: string;
  workEnd: string;
  /** How long one cron tick may keep starting work. Defaults to 45s. */
  tickBudgetMs?: number;
  /** Jobs started together. Defaults to 4. */
  concurrency?: number;
};

// Automatic scout, analyst, and copy sleep outside jam kerja.
// Rewrites and renders a person queued are marked manual and always run.
// Designer keeps rendering too, including the picture that follows a rewrite.
const WORK_HOUR_GATED: Set<JobName> = new Set(["scout.scan", "analyst.score", "copywriter.write"]);

type ClaimedJob = {
  id: string;
  name: JobName;
  payload: Record<string, unknown>;
  manual: boolean;
  attempts: number;
  reclaimed: boolean;
  lockToken: Date;
  lostLock: boolean;
};

// A carousel may poll several containers for ~72s each. Keep the lock longer
// than that so a live publish is not reclaimed and marked failed.
const PUBLISHER_LOCK_STALE_MS = 8 * 60_000;
const DEFAULT_LOCK_STALE_MS = 3 * 60_000;
const TICK_BUDGET_MS = 45_000;
const CONCURRENCY = 4;
const DESIGNER_SLOTS = 2;
const RATE_LIMIT_ATTEMPTS = 8;
const GEMINI_JOBS: Set<JobName> = new Set(["analyst.score", "copywriter.write"]);

function calendarParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(bag.year), month: Number(bag.month), day: Number(bag.day) };
}

function clockParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { hour: Number(bag.hour), minute: Number(bag.minute) };
}

function instantInTimeZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const rough = Date.UTC(year, month - 1, day, 12, 0);
  for (let offsetMs = -14 * 3600_000; offsetMs <= 14 * 3600_000; offsetMs += 60_000) {
    const candidate = new Date(rough + offsetMs);
    const cal = calendarParts(candidate, timeZone);
    if (cal.year !== year || cal.month !== month || cal.day !== day) {
      continue;
    }
    const clock = clockParts(candidate, timeZone);
    if (clock.hour === hour && clock.minute === minute) {
      return candidate;
    }
  }
  throw new Error("could not resolve zoned instant");
}

function nextWorkStart(now: Date, workStart: string, timeZone = TIME_ZONE): Date {
  const [sh, sm] = workStart.split(":").map(Number);
  const { year, month, day } = calendarParts(now, timeZone);
  let start = instantInTimeZone(year, month, day, sh, sm, timeZone);
  if (start.getTime() <= now.getTime()) {
    const noon = instantInTimeZone(year, month, day, 12, 0, timeZone);
    const nextCal = calendarParts(new Date(noon.getTime() + 24 * 3600_000), timeZone);
    start = instantInTimeZone(nextCal.year, nextCal.month, nextCal.day, sh, sm, timeZone);
  }
  return start;
}

function sameLock(param: string): string {
  return `date_trunc('milliseconds', locked_at) = date_trunc('milliseconds', ${param}::timestamptz)`;
}

function parsePayload(raw: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof raw === "string") {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  return raw;
}

export async function enqueue(
  sql: Sql,
  job: { name: JobName; payload: Record<string, unknown>; runAt: Date; manual?: boolean },
): Promise<void> {
  await sql.rows(
    `insert into jobs (id, name, payload, run_at, manual) values ($1, $2, $3::jsonb, $4, $5)`,
    [randomUUID(), job.name, JSON.stringify(job.payload), job.runAt, job.manual ?? false],
  );
}

type DueRow = {
  id: string;
  name: JobName;
  payload: Record<string, unknown> | string;
  manual: boolean;
  attempts: number;
  locked_at: Date | string | null;
  run_at: Date | string;
};

function jobRank(name: JobName, payload: Record<string, unknown>): number {
  if (name === "publisher.publish") return 0;
  if (name === "designer.render") return 2;
  if (name === "copywriter.write" && payload.regenerateDemo === true) return 3;
  return 1;
}

function selectFairBatch(rows: DueRow[], concurrency: number): DueRow[] {
  const ranked = rows
    .map((row) => ({ row, payload: parsePayload(row.payload), at: new Date(row.run_at).getTime() }))
    .sort((a, b) => {
      const rank = jobRank(a.row.name, a.payload) - jobRank(b.row.name, b.payload);
      if (rank !== 0) return rank;
      const aLocked = a.row.locked_at == null ? 1 : 0;
      const bLocked = b.row.locked_at == null ? 1 : 0;
      if (aLocked !== bLocked) return aLocked - bLocked;
      return a.at - b.at;
    });
  const selected: DueRow[] = [];
  const chosen = new Set<string>();
  const take = (row: DueRow) => {
    if (chosen.has(row.id) || selected.length >= concurrency) return;
    chosen.add(row.id);
    selected.push(row);
  };
  const normal = ranked.filter((item) => jobRank(item.row.name, item.payload) <= 1);
  if (normal[0]) take(normal[0].row);
  const designers = ranked.filter((item) => item.row.name === "designer.render");
  const rewrites = ranked.filter((item) => jobRank(item.row.name, item.payload) === 3);
  let designerCount = 0;
  let di = 0;
  let ri = 0;
  while (selected.length < concurrency && (di < designers.length || ri < rewrites.length)) {
    if (designerCount < DESIGNER_SLOTS && di < designers.length) {
      take(designers[di].row);
      designerCount += 1;
      di += 1;
      continue;
    }
    if (ri < rewrites.length) {
      take(rewrites[ri].row);
      ri += 1;
      continue;
    }
    if (di < designers.length) {
      take(designers[di].row);
      di += 1;
      continue;
    }
    break;
  }
  for (const item of normal) {
    take(item.row);
  }
  for (const item of ranked) {
    take(item.row);
  }
  return selected;
}

async function claimDueJobs(sql: Sql, now: Date, concurrency: number): Promise<ClaimedJob[]> {
  const publishStaleBefore = new Date(now.getTime() - PUBLISHER_LOCK_STALE_MS);
  const otherStaleBefore = new Date(now.getTime() - DEFAULT_LOCK_STALE_MS);
  return sql.tx(async (tx) => {
    const rows = await tx.rows<DueRow>(
      `       with due as (
         select id, run_at, locked_at,
           case
             when name = 'designer.render' then 'design'
             when name = 'copywriter.write' and coalesce(payload->>'regenerateDemo', '') = 'true' then 'rewrite'
             else 'normal'
           end as lane
         from jobs
         where run_at <= $1
           and finished_at is null
           and (
             locked_at is null
             or (name = 'publisher.publish' and locked_at < $2)
             or (name <> 'publisher.publish' and locked_at < $3)
           )
       ),
       ranked as (
         select id, lane, locked_at, row_number() over (partition by lane order by run_at) as rn
         from due
       ),
       picked as (
         select id from ranked
         where (lane = 'design' and rn <= 8)
            or (lane = 'normal' and rn <= 8)
            or (lane = 'rewrite' and rn <= 24)
            or locked_at is not null
       )
       select j.id, j.name, j.payload, j.manual, j.attempts, j.locked_at, j.run_at
       from jobs j
       join picked on picked.id = j.id
       for update of j skip locked`,
      [now, publishStaleBefore, otherStaleBefore],
    );
    const picked = selectFairBatch(rows, concurrency);
    for (const row of picked) {
      await tx.rows(`update jobs set locked_at = $1 where id = $2`, [now, row.id]);
    }
    return picked.map((row) => ({
      id: row.id,
      name: row.name,
      payload: parsePayload(row.payload),
      manual: row.manual,
      attempts: row.attempts,
      reclaimed: row.locked_at != null,
      lockToken: now,
      lostLock: false,
    }));
  });
}

async function enqueueDirtySlideRenders(sql: Sql, now: Date): Promise<void> {
  const rows = await sql.rows<{ id: string }>(
    `select d.id
     from drafts d
     where d.status = 'needs_review'
       and d.text_dirty = true
       and not exists (
         select 1 from jobs j
         where j.name = 'designer.render'
           and j.payload->>'draftId' = d.id::text
           and (
             j.finished_at is null
             or (j.finished_at >= d.updated_at and coalesce(j.error, '') <> '')
           )
       )`,
  );
  for (const row of rows) {
    await enqueue(sql, {
      name: "designer.render",
      payload: { draftId: row.id },
      runAt: now,
      manual: true,
    });
  }
}

async function releaseJobLock(sql: Sql, jobId: string, token: Date): Promise<void> {
  try {
    await sql.rows(`update jobs set locked_at = null where id = $1 and ${sameLock("$2")}`, [jobId, token]);
  } catch {
    // A bookkeeping failure on one job must not abort the rest of the batch.
  }
}

async function refreshJobLock(sql: Sql, job: ClaimedJob, start: Date): Promise<boolean> {
  const refreshed = await sql.rows<{ id: string }>(
    `update jobs set locked_at = $1 where id = $2 and ${sameLock("$3")} returning id`,
    [start, job.id, job.lockToken],
  );
  if (refreshed.length === 0) {
    job.lostLock = true;
    return false;
  }
  job.lockToken = start;
  return true;
}

async function runClaimedJob(sql: Sql, job: ClaimedJob, now: Date, deps: JobDeps): Promise<boolean> {
  try {
    const start = new Date();
    if (!(await refreshJobLock(sql, job, start))) {
      return false;
    }

    if (
      WORK_HOUR_GATED.has(job.name) &&
      !job.manual &&
      !isWithinWorkHours(now, deps.workStart, deps.workEnd)
    ) {
      try {
        const runAt = nextWorkStart(now, deps.workStart);
        await sql.rows(
          `update jobs set locked_at = null, run_at = $1 where id = $2 and ${sameLock("$3")}`,
          [runAt, job.id, job.lockToken],
        );
      } catch {
        // defer bookkeeping failure; lock cleared in finally
      }
      return false;
    }

    if (GEMINI_JOBS.has(job.name)) {
      const pause = await readGeminiPause(sql, now);
      if (pause) {
        try {
          await sql.rows(
            `update jobs set error = $1, locked_at = null, run_at = $2 where id = $3 and ${sameLock("$4")}`,
            [pause.message, pause.until, job.id, job.lockToken],
          );
        } catch {
          // defer bookkeeping failure; lock cleared in finally
        }
        return false;
      }
    }

    const ctx: JobCtx = {
      sql,
      payload: job.payload,
      manual: job.manual,
      now,
      attempts: job.attempts,
      reclaimed: job.reclaimed,
    };
    try {
      await deps.handlers[job.name](ctx);
      try {
        const finished = await sql.rows<{ id: string }>(
          `update jobs set finished_at = $1, locked_at = null, error = null where id = $2 and ${sameLock("$3")} returning id`,
          [now, job.id, job.lockToken],
        );
        return finished.length > 0;
      } catch {
        return false;
      }
    } catch (error) {
      if (error instanceof LlmRateLimitError && !error.countsAsAttempt) {
        const delay = Math.max(1_000, error.retryAfterMs);
        try {
          if (error.perDay || delay >= 60_000) {
            await recordGeminiPause(sql, now, delay, {
              perDay: error.perDay,
              kind: error.perDay ? "day" : "unknown",
              metric: error.quotaMetric,
              quotaId: error.quotaId,
              limit: error.quotaLimit,
            });
          }
          await sql.rows(
            `update jobs set error = $1, locked_at = null, run_at = $2 where id = $3 and ${sameLock("$4")}`,
            [error.message, new Date(now.getTime() + delay), job.id, job.lockToken],
          );
        } catch {
          // retry bookkeeping failure; lock cleared in finally
        }
        return false;
      }
      if (error instanceof LlmRateLimitError) {
        const attempts = job.attempts + 1;
        const message = error.message;
        const delay = Math.min(120_000, Math.max(error.retryAfterMs, 5_000) * 2 ** Math.max(0, attempts - 1));
        try {
          if (attempts < RATE_LIMIT_ATTEMPTS) {
            await sql.rows(
              `update jobs set attempts = $1, error = $2, locked_at = null, run_at = $3 where id = $4 and ${sameLock("$5")}`,
              [attempts, message, new Date(now.getTime() + delay), job.id, job.lockToken],
            );
          } else {
            await sql.rows(
              `update jobs set attempts = $1, error = $2, locked_at = null, finished_at = $3 where id = $4 and ${sameLock("$5")}`,
              [attempts, message, now, job.id, job.lockToken],
            );
          }
        } catch {
          // retry bookkeeping failure; lock cleared in finally
        }
        return false;
      }
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      try {
        if (attempts < 3) {
          const retryAt = new Date(now.getTime() + 5 * 60_000);
          await sql.rows(
            `update jobs set attempts = $1, error = $2, locked_at = null, run_at = $3 where id = $4 and ${sameLock("$5")}`,
            [attempts, message, retryAt, job.id, job.lockToken],
          );
        } else {
          await sql.rows(
            `update jobs set attempts = $1, error = $2, locked_at = null, finished_at = $3 where id = $4 and ${sameLock("$5")}`,
            [attempts, message, now, job.id, job.lockToken],
          );
        }
      } catch {
        // retry bookkeeping failure; lock cleared in finally
      }
      return false;
    }
  } finally {
    if (!job.lostLock) {
      await releaseJobLock(sql, job.id, job.lockToken);
    }
  }
}

export async function runDueJobs(sql: Sql, now: Date, deps: JobDeps): Promise<number> {
  return withGeminiSql(sql, () => runDueJobsInner(sql, now, deps));
}

async function runDueJobsInner(sql: Sql, now: Date, deps: JobDeps): Promise<number> {
  const budgetMs = deps.tickBudgetMs ?? TICK_BUDGET_MS;
  const concurrency = deps.concurrency ?? CONCURRENCY;
  const deadline = Date.now() + budgetMs;
  let ran = 0;
  await enqueueDirtySlideRenders(sql, now);

  while (Date.now() < deadline) {
    if (ran > 0 && deadline - Date.now() < 12_000) {
      break;
    }
    const claimed = await claimDueJobs(sql, now, concurrency);
    if (claimed.length === 0) {
      break;
    }
    try {
      const outcomes = await Promise.all(claimed.map((job) => runClaimedJob(sql, job, now, deps)));
      ran += outcomes.filter(Boolean).length;
    } finally {
      for (const job of claimed) {
        if (!job.lostLock) {
          await releaseJobLock(sql, job.id, job.lockToken);
        }
      }
    }
    if (claimed.length < concurrency) {
      break;
    }
  }

  return ran;
}
