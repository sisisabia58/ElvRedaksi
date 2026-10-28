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
});
