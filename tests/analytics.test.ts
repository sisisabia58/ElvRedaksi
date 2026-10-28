import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { analyticsView } from "../src/studio/analytics";
import { runInsights } from "../src/jobs/handlers";

describe("analytics", () => {
  it("does not invent numbers when Instagram is disconnected", async () => {
    const sql = await createTestSql();
    await runInsights({ sql, payload: {}, manual: true, now: new Date("2026-10-28T02:00:00Z"), fetchImpl: fetch });
    const view = await analyticsView(sql, 28, new Date("2026-10-28T02:00:00Z"));
    expect(view.empty).toBe(true);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'analitik'");
    expect(log[0].message).toBe("Analitik dilewati: Instagram belum terhubung");
  });

  it("does not invent numbers when Instagram rejects the token", async () => {
    const sql = await createTestSql();
    const now = new Date("2026-10-28T02:00:00Z");
    await sql.rows(
      `insert into ig_connection (id, ig_user_id, access_token, username)
       values (1, $1, $2, $3)
       on conflict (id) do update set ig_user_id = $1, access_token = $2, username = $3`,
      ["1789", "token", "redaksi"],
    );
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Invalid OAuth" } }), { status: 400 });
    await runInsights({ sql, payload: {}, manual: true, now, fetchImpl });
    const view = await analyticsView(sql, 28, now);
    expect(view.empty).toBe(true);
    const snapshots = await sql.rows("select id from insight_snapshots");
    expect(snapshots).toHaveLength(0);
    const posts = await sql.rows("select draft_id from post_insights");
    expect(posts).toHaveLength(0);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'analitik'");
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("Analitik gagal diambil dari Instagram");
    const jobs = await sql.rows<{ run_at: string | Date; finished_at: string | Date | null }>(
      "select run_at, finished_at from jobs where name = 'insights.sync' and finished_at is null",
    );
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0].run_at).toISOString()).toBe(new Date(now.getTime() + 30 * 60 * 1000).toISOString());
  });

  it("keeps the sync cadence when Instagram is unreachable", async () => {
    const sql = await createTestSql();
    const now = new Date("2026-10-28T02:00:00Z");
    await sql.rows(
      `insert into ig_connection (id, ig_user_id, access_token, username)
       values (1, $1, $2, $3)
       on conflict (id) do update set ig_user_id = $1, access_token = $2, username = $3`,
      ["1789", "token", "redaksi"],
    );
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    await runInsights({ sql, payload: {}, manual: true, now, fetchImpl });
    const snapshots = await sql.rows("select id from insight_snapshots");
    expect(snapshots).toHaveLength(0);
    const log = await sql.rows<{ message: string }>("select message from activity where agent = 'analitik'");
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("Analitik gagal diambil dari Instagram");
    const jobs = await sql.rows<{ run_at: string | Date }>(
      "select run_at from jobs where name = 'insights.sync' and finished_at is null",
    );
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0].run_at).toISOString()).toBe(new Date(now.getTime() + 30 * 60 * 1000).toISOString());
  });

  it("computes a follower delta in people and a views delta in percent", async () => {
    const sql = await createTestSql();
    const daily = [
      { date: "2026-10-01", views: 100, reach: 80, followers: 1000 },
      { date: "2026-10-20", views: 200, reach: 150, followers: 900 },
    ];
    await sql.rows(
      `insert into insight_snapshots (id, taken_at, followers, views, reach, interactions, accounts_engaged, daily)
       values ($1,$2,900,300,230,10,4,$3::jsonb)`,
      ["dddddddd-dddd-dddd-dddd-ddddddddddd1", "2026-10-28T00:00:00Z", JSON.stringify(daily)],
    );
    const view = await analyticsView(sql, 28, new Date("2026-10-28T02:00:00Z"));
    expect(view.empty).toBe(false);
    expect(view.followers.deltaKind).toBe("absolute");
    expect(view.views.deltaKind).toBe("percent");
  });
});
