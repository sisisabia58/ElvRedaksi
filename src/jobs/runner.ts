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
};

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
  let { year, month, day } = calendarParts(now, timeZone);
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
  return sql.tx(async (tx) => {
    const rows = await tx.rows<{
      id: string;
      name: JobName;
      payload: Record<string, unknown> | string;
      manual: boolean;
      attempts: number;
    }>(
      `select id, name, payload, manual, attempts
       from jobs
       where run_at <= $1 and finished_at is null and locked_at is null
       order by run_at
       limit 5
       for update skip locked`,
      [now],
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
    }));
  });
}

async function releaseJobLock(sql: Sql, jobId: string): Promise<void> {
  try {
    await sql.rows(`update jobs set locked_at = null where id = $1 and locked_at is not null`, [jobId]);
  } catch {
    // A bookkeeping failure on one job must not abort the rest of the batch.
  }
}

async function runClaimedJob(sql: Sql, job: ClaimedJob, now: Date, deps: JobDeps): Promise<boolean> {
  try {
    if (
      WORK_HOUR_GATED.has(job.name) &&
      !job.manual &&
      !isWithinWorkHours(now, deps.workStart, deps.workEnd)
    ) {
      try {
        const runAt = nextWorkStart(now, deps.workStart);
        await sql.rows(`update jobs set locked_at = null, run_at = $1 where id = $2`, [runAt, job.id]);
      } catch {
        // defer bookkeeping failure; lock cleared in finally
      }
      return false;
    }

    const ctx: JobCtx = { sql, payload: job.payload, manual: job.manual, now };
    try {
      await deps.handlers[job.name](ctx);
      try {
        await sql.rows(`update jobs set finished_at = $1, locked_at = null where id = $2`, [now, job.id]);
        return true;
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
            `update jobs set attempts = $1, error = $2, locked_at = null, run_at = $3 where id = $4`,
            [attempts, message, retryAt, job.id],
          );
        } else {
          await sql.rows(
            `update jobs set attempts = $1, error = $2, locked_at = null, finished_at = $3 where id = $4`,
            [attempts, message, now, job.id],
          );
        }
      } catch {
        // retry bookkeeping failure; lock cleared in finally
      }
      return false;
    }
  } finally {
    await releaseJobLock(sql, job.id);
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
      await releaseJobLock(sql, job.id);
    }
  }

  return ran;
}
