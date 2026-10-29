import { randomUUID } from "node:crypto";
import type { Sql } from "../db/client";
import { TIME_ZONE } from "../domain/constants";
import { isWithinWorkHours } from "../domain/time";

export type JobName =
  | "scout.scan"
  | "analyst.score"
  | "copywriter.write"
  | "designer.render"
  | "publisher.publish"
  | "insights.sync";

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
};

const WORK_HOUR_GATED: Set<JobName> = new Set([
  "scout.scan",
  "analyst.score",
  "copywriter.write",
  "designer.render",
]);

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

const PUBLISHER_LOCK_STALE_MS = 60_000;
const DEFAULT_LOCK_STALE_MS = 10 * 60_000;

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

async function claimDueJobs(sql: Sql, now: Date): Promise<ClaimedJob[]> {
  const publishStaleBefore = new Date(now.getTime() - PUBLISHER_LOCK_STALE_MS);
  const otherStaleBefore = new Date(now.getTime() - DEFAULT_LOCK_STALE_MS);
  return sql.tx(async (tx) => {
    const rows = await tx.rows<{
      id: string;
      name: JobName;
      payload: Record<string, unknown> | string;
      manual: boolean;
      attempts: number;
      locked_at: Date | string | null;
    }>(
      `select id, name, payload, manual, attempts, locked_at
       from jobs
       where run_at <= $1
         and finished_at is null
         and (
           locked_at is null
           or (name = 'publisher.publish' and locked_at < $2)
           or (name <> 'publisher.publish' and locked_at < $3)
         )
       order by run_at
       limit 5
       for update skip locked`,
      [now, publishStaleBefore, otherStaleBefore],
    );
    for (const row of rows) {
      await tx.rows(`update jobs set locked_at = $1 where id = $2`, [now, row.id]);
    }
    return rows.map((row) => ({
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

async function releaseJobLock(sql: Sql, jobId: string, token: Date): Promise<void> {
  try {
    await sql.rows(`update jobs set locked_at = null where id = $1 and locked_at = $2`, [jobId, token]);
  } catch {
    // A bookkeeping failure on one job must not abort the rest of the batch.
  }
}

async function refreshJobLock(sql: Sql, job: ClaimedJob, start: Date): Promise<boolean> {
  const refreshed = await sql.rows<{ id: string }>(
    `update jobs set locked_at = $1 where id = $2 and locked_at = $3 returning id`,
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
          `update jobs set locked_at = null, run_at = $1 where id = $2 and locked_at = $3`,
          [runAt, job.id, job.lockToken],
        );
      } catch {
        // defer bookkeeping failure; lock cleared in finally
      }
      return false;
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
          `update jobs set finished_at = $1, locked_at = null where id = $2 and locked_at = $3 returning id`,
          [now, job.id, job.lockToken],
        );
        return finished.length > 0;
      } catch {
        return false;
      }
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      try {
        if (attempts < 3) {
          const retryAt = new Date(now.getTime() + 5 * 60_000);
          await sql.rows(
            `update jobs set attempts = $1, error = $2, locked_at = null, run_at = $3 where id = $4 and locked_at = $5`,
            [attempts, message, retryAt, job.id, job.lockToken],
          );
        } else {
          await sql.rows(
            `update jobs set attempts = $1, error = $2, locked_at = null, finished_at = $3 where id = $4 and locked_at = $5`,
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
  const claimed = await claimDueJobs(sql, now);
  let ran = 0;

  try {
    for (const job of claimed) {
      if (await runClaimedJob(sql, job, now, deps)) {
        ran += 1;
      }
    }
  } finally {
    for (const job of claimed) {
      if (!job.lostLock) {
        await releaseJobLock(sql, job.id, job.lockToken);
      }
    }
  }

  return ran;
}
