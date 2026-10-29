import { describe, expect, it } from "vitest";
import { POST } from "../app/api/cron/route";
import { createTestSql } from "../src/db/client";
import type { Sql } from "../src/db/client";
import { enqueue, runDueJobs, type JobDeps } from "../src/jobs/runner";

const noopHandlers: JobDeps["handlers"] = {
  "scout.scan": async () => {},
  "analyst.score": async () => {},
  "copywriter.write": async () => {},
  "designer.render": async () => {},
  "publisher.publish": async () => {},
  "insights.sync": async () => {},
};

describe("jobs", () => {
  it("runs a due manual scout immediately and delays an auto scout at night", async () => {
    const sql = await createTestSql();
    const seen: string[] = [];
    const deps = {
      workStart: "07:00",
      workEnd: "22:00",
      handlers: {
        "scout.scan": async () => {
          seen.push("scout");
        },
        "analyst.score": async () => {},
        "copywriter.write": async () => {},
        "designer.render": async () => {},
        "publisher.publish": async () => {
          seen.push("publish");
        },
        "insights.sync": async () => {},
      },
    };
    const night = new Date("2026-10-27T16:00:00Z"); // 23:00 WIB
    await enqueue(sql, { name: "scout.scan", payload: {}, runAt: night, manual: true });
    await enqueue(sql, { name: "scout.scan", payload: { auto: true }, runAt: night, manual: false });
    await enqueue(sql, { name: "publisher.publish", payload: { id: "d1" }, runAt: night, manual: false });
    const ran = await runDueJobs(sql, night, deps);
    expect(ran).toBe(2);
    expect(seen).toEqual(["scout", "publish"]);
    const waiting = await sql.rows<{ finished_at: string | null }>(
      "select finished_at from jobs where payload->>'auto' = 'true'",
    );
    expect(waiting[0].finished_at).toBeNull();
  });

  it("retries a failed handler and finishes it on the third miss", async () => {
    const sql = await createTestSql();
    await enqueue(sql, { name: "insights.sync", payload: {}, runAt: new Date("2026-10-28T00:00:00Z") });
    const deps = {
      workStart: "07:00",
      workEnd: "22:00",
      handlers: {
        "scout.scan": async () => {},
        "analyst.score": async () => {},
        "copywriter.write": async () => {},
        "designer.render": async () => {},
        "publisher.publish": async () => {},
        "insights.sync": async () => {
          throw new Error("meta down");
        },
      },
    };
    await runDueJobs(sql, new Date("2026-10-28T00:00:00Z"), deps);
    await runDueJobs(sql, new Date("2026-10-28T00:06:00Z"), deps);
    await runDueJobs(sql, new Date("2026-10-28T00:12:00Z"), deps);
    const row = await sql.rows<{ attempts: number; finished_at: string | null; error: string }>(
      "select attempts, finished_at, error from jobs",
    );
    expect(row[0].attempts).toBe(3);
    expect(row[0].finished_at).not.toBeNull();
    expect(row[0].error).toMatch(/meta down/);
  });

  it("rejects cron when CRON_SECRET is missing or empty", async () => {
    const previous = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const response = await POST(
        new Request("http://localhost/api/cron", {
          method: "POST",
          headers: { Authorization: "Bearer " },
        }),
      );
      expect(response.status).toBe(401);
    } finally {
      if (previous === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previous;
      }
    }
  });

  it("clears locks on every claimed job when a bookkeeping update throws", async () => {
    const sql = await createTestSql();
    const now = new Date("2026-10-28T10:00:00Z");
    await enqueue(sql, { name: "insights.sync", payload: { batch: 1 }, runAt: now });
    await enqueue(sql, { name: "insights.sync", payload: { batch: 2 }, runAt: now });

    const base = sql.rows.bind(sql);
    let finishUpdates = 0;
    const flakySql: Sql = {
      ...sql,
      rows<T>(text: string, params?: unknown[]) {
        if (text.includes("set finished_at") && finishUpdates++ === 0) {
          return Promise.reject(new Error("db write failed"));
        }
        return base<T>(text, params);
      },
    };

    const deps: JobDeps = {
      workStart: "07:00",
      workEnd: "22:00",
      handlers: noopHandlers,
    };

    await expect(runDueJobs(flakySql, now, deps)).resolves.toBe(1);

    const locked = await sql.rows<{ id: string }>("select id from jobs where locked_at is not null");
    expect(locked).toHaveLength(0);
  });

  it("claims a lock older than the threshold and leaves a lock set to now", async () => {
    const sql = await createTestSql();
    const now = new Date("2026-10-28T10:00:00Z");
    const seen: { id: string; reclaimed: boolean; attempts: number }[] = [];
    const deps: JobDeps = {
      workStart: "07:00",
      workEnd: "22:00",
      handlers: {
        ...noopHandlers,
        "publisher.publish": async (ctx) => {
          seen.push({
            id: String(ctx.payload.id),
            reclaimed: ctx.reclaimed === true,
            attempts: ctx.attempts ?? -1,
          });
        },
        "insights.sync": async (ctx) => {
          seen.push({
            id: String(ctx.payload.id),
            reclaimed: ctx.reclaimed === true,
            attempts: ctx.attempts ?? -1,
          });
        },
      },
    };

    async function job(
      id: string,
      name: "publisher.publish" | "insights.sync",
      lockedAt: Date | null,
      finishedAt: Date | null,
    ) {
      await sql.rows(
        `insert into jobs (id, name, payload, run_at, locked_at, finished_at, attempts)
         values ($1, $2, $3::jsonb, $4, $5, $6, 0)`,
        [id, name, JSON.stringify({ id }), now, lockedAt, finishedAt],
      );
    }

    await job("11111111-1111-1111-1111-111111111111", "publisher.publish", new Date(now.getTime() - 61_000), null);
    await job("22222222-2222-2222-2222-222222222222", "publisher.publish", now, null);
    await job("33333333-3333-3333-3333-333333333333", "publisher.publish", new Date(now.getTime() - 59_000), null);
    await job("44444444-4444-4444-4444-444444444444", "insights.sync", new Date(now.getTime() - 61_000), null);
    await job("55555555-5555-5555-5555-555555555555", "insights.sync", new Date(now.getTime() - 11 * 60_000), null);
    await job("66666666-6666-6666-6666-666666666666", "insights.sync", null, null);
    await job(
      "77777777-7777-7777-7777-777777777777",
      "publisher.publish",
      new Date(now.getTime() - 120_000),
      now,
    );

    const ran = await runDueJobs(sql, now, deps);
    expect(ran).toBe(3);
    expect(seen.map((row) => row.id).sort()).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "55555555-5555-5555-5555-555555555555",
      "66666666-6666-6666-6666-666666666666",
    ]);
    expect(seen.find((row) => row.id.startsWith("11111111"))).toMatchObject({ reclaimed: true, attempts: 0 });
    expect(seen.find((row) => row.id.startsWith("55555555"))).toMatchObject({ reclaimed: true, attempts: 0 });
    expect(seen.find((row) => row.id.startsWith("66666666"))).toMatchObject({ reclaimed: false, attempts: 0 });

    const untouched = await sql.rows<{ id: string; finished_at: Date | null }>(
      `select id, finished_at from jobs
       where id in ($1, $2, $3, $4)
       order by id`,
      [
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
        "44444444-4444-4444-4444-444444444444",
        "77777777-7777-7777-7777-777777777777",
      ],
    );
    expect(untouched.map((row) => row.id)).toEqual([
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
      "77777777-7777-7777-7777-777777777777",
    ]);
    expect(untouched[0]?.finished_at).toBeNull();
    expect(untouched[1]?.finished_at).toBeNull();
    expect(untouched[2]?.finished_at).toBeNull();
  });

  it("does not let a second claim take a refreshed lock or clear it with the old token", async () => {
    const sql = await createTestSql();
    const now = new Date(Date.now() - 120_000);
    const jobId = "88888888-8888-4888-8888-888888888888";
    await sql.rows(
      `insert into jobs (id, name, payload, run_at, attempts)
       values ($1, 'publisher.publish', $2::jsonb, $3, 0)`,
      [jobId, JSON.stringify({ id: jobId }), now],
    );

    const ownerLock = new Date(Date.now() + 5 * 60_000);
    let calls = 0;
    let lockAfterOldUnlock: Date | string | null = null;
    let secondRan = -1;
    const deps: JobDeps = {
      workStart: "07:00",
      workEnd: "22:00",
      handlers: {
        ...noopHandlers,
        "publisher.publish": async () => {
          calls += 1;
          if (calls > 1) return;

          await sql.rows(`update jobs set locked_at = null where id = $1 and locked_at = $2`, [jobId, now]);
          const held = await sql.rows<{ locked_at: Date | string | null }>(
            "select locked_at from jobs where id = $1",
            [jobId],
          );
          lockAfterOldUnlock = held[0]?.locked_at ?? null;
          secondRan = await runDueJobs(sql, new Date(), deps);
          await sql.rows(`update jobs set locked_at = $1 where id = $2`, [ownerLock, jobId]);
        },
      },
    };

    const ran = await runDueJobs(sql, now, deps);
    expect(calls).toBe(1);
    expect(lockAfterOldUnlock).not.toBeNull();
    expect(secondRan).toBe(0);
    expect(ran).toBe(0);

    const row = await sql.rows<{ locked_at: Date | string | null; finished_at: Date | string | null }>(
      "select locked_at, finished_at from jobs where id = $1",
      [jobId],
    );
    expect(row[0]?.finished_at).toBeNull();
    const lockedAt = row[0]?.locked_at instanceof Date ? row[0].locked_at : new Date(String(row[0]?.locked_at));
    expect(lockedAt.getTime()).toBe(ownerLock.getTime());
  });
});
