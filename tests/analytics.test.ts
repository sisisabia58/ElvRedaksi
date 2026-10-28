import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { analyticsView, followerLineCoordinates } from "../src/studio/analytics";
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

  it("dates a day by the period it covers and does not copy today's followers backward", async () => {
    const sql = await createTestSql();
    const now = new Date("2026-10-28T02:00:00Z");
    await sql.rows(
      `insert into ig_connection (id, ig_user_id, access_token, username)
       values (1, $1, $2, $3)
       on conflict (id) do update set ig_user_id = $1, access_token = $2, username = $3`,
      ["1789", "token", "redaksi"],
    );
    const fetchImpl: typeof fetch = async (input) => {
      const url = requestUrl(input);
      if (url.includes("/insights")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                name: "views",
                period: "day",
                values: [
                  { value: 40, end_time: "2026-10-28T00:00:00+07:00" },
                  { value: 55, end_time: "2026-10-29T00:00:00+07:00" },
                ],
              },
              {
                name: "reach",
                period: "day",
                values: [
                  { value: 30, end_time: "2026-10-28T00:00:00+07:00" },
                  { value: 33, end_time: "2026-10-29T00:00:00+07:00" },
                ],
              },
            ],
          }),
        );
      }
      if (url.includes("/media")) return new Response(JSON.stringify({ data: [] }));
      return new Response(JSON.stringify({ followers_count: 1280, id: "1789" }));
    };
    await runInsights({ sql, payload: {}, manual: true, now, fetchImpl });
    const snapshots = await sql.rows<{ followers: number; daily: unknown }>(
      "select followers, daily from insight_snapshots",
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].followers).toBe(1280);
    expect(asDailyRows(snapshots[0].daily)).toEqual([
      { date: "2026-10-27", views: 40, reach: 30, followers: null },
      { date: "2026-10-28", views: 55, reach: 33, followers: 1280 },
    ]);
  });

  it("copies a previously measured follower count and still stamps today with the live count", async () => {
    const sql = await createTestSql();
    const now = new Date("2026-10-28T02:00:00Z");
    await sql.rows(
      `insert into ig_connection (id, ig_user_id, access_token, username)
       values (1, $1, $2, $3)
       on conflict (id) do update set ig_user_id = $1, access_token = $2, username = $3`,
      ["1789", "token", "redaksi"],
    );
    await sql.rows(
      `insert into insight_snapshots (id, taken_at, followers, views, reach, interactions, accounts_engaged, daily)
       values ($1, $2, 1100, 1, 1, 0, null, $3::jsonb)`,
      [
        "dddddddd-dddd-dddd-dddd-ddddddddddd2",
        "2026-10-27T02:00:00Z",
        JSON.stringify([
          { date: "2026-10-27", views: 1, reach: 1, followers: 1100 },
          { date: "2026-10-28", views: 1, reach: 1, followers: 999 },
        ]),
      ],
    );
    const fetchImpl: typeof fetch = async (input) => {
      const url = requestUrl(input);
      if (url.includes("/insights")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                name: "views",
                period: "day",
                values: [
                  { value: 10, end_time: "2026-10-27T00:00:00+07:00" },
                  { value: 40, end_time: "2026-10-28T00:00:00+07:00" },
                  { value: 55, end_time: "2026-10-29T00:00:00+07:00" },
                ],
              },
              {
                name: "reach",
                period: "day",
                values: [
                  { value: 8, end_time: "2026-10-27T00:00:00+07:00" },
                  { value: 30, end_time: "2026-10-28T00:00:00+07:00" },
                  { value: 33, end_time: "2026-10-29T00:00:00+07:00" },
                ],
              },
            ],
          }),
        );
      }
      if (url.includes("/media")) return new Response(JSON.stringify({ data: [] }));
      return new Response(JSON.stringify({ followers_count: 1280, id: "1789" }));
    };
    await runInsights({ sql, payload: {}, manual: true, now, fetchImpl });
    const snapshots = await sql.rows<{ taken_at: string | Date; daily: unknown }>(
      "select taken_at, daily from insight_snapshots order by taken_at desc",
    );
    expect(asDailyRows(snapshots[0].daily)).toEqual([
      { date: "2026-10-26", views: 10, reach: 8, followers: null },
      { date: "2026-10-27", views: 40, reach: 30, followers: 1100 },
      { date: "2026-10-28", views: 55, reach: 33, followers: 1280 },
    ]);
  });

  it("leaves the follower delta null when the window's last point has no follower count", async () => {
    const sql = await createTestSql();
    const daily = [
      { date: "2026-09-30", views: 12, reach: 9, followers: 800 },
      { date: "2026-10-20", views: 20, reach: 15, followers: 900 },
      { date: "2026-10-28", views: 22, reach: 16, followers: null },
    ];
    await sql.rows(
      `insert into insight_snapshots (id, taken_at, followers, views, reach, interactions, accounts_engaged, daily)
       values ($1,$2,900,54,40,0,null,$3::jsonb)`,
      ["dddddddd-dddd-dddd-dddd-ddddddddddd3", "2026-10-28T00:00:00Z", JSON.stringify(daily)],
    );
    const view = await analyticsView(sql, 28, new Date("2026-10-28T02:00:00Z"));
    expect(view.followers.deltaKind).toBe("absolute");
    expect(view.followers.delta).toBeNull();
    expect(view.followers.value).toBe(900);
    expect(view.daily).toEqual([
      { date: "2026-10-20", views: 20, reach: 15, followers: 900 },
      { date: "2026-10-28", views: 22, reach: 16, followers: null },
    ]);
  });

  it("places the only measured follower day at the end of a 28-day width", () => {
    const width = 640;
    const daily = Array.from({ length: 28 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, "0")}`,
      views: 0,
      reach: 0,
      followers: index === 27 ? 42 : null,
    }));
    const points = followerLineCoordinates(daily, width, 160);
    expect(points).toHaveLength(28);
    expect(points[27]).toEqual({ x: width, y: 80 });
    expect(points.slice(0, 27).every((point) => point == null)).toBe(true);
  });

  it("keeps a null follower day as a gap so the neighbors stay on their daily slots", () => {
    const width = 270;
    const daily = Array.from({ length: 28 }, (_, index) => ({
      date: `d-${index}`,
      views: 1,
      reach: 1,
      followers: index === 0 ? 10 : index === 2 ? 20 : null,
    }));
    const points = followerLineCoordinates(daily, width, 160);
    expect(points[1]).toBeNull();
    expect(points[0]?.x).toBe(0);
    expect(points[2]?.x).toBe((2 / 27) * width);
    expect(points[2]!.x).toBeLessThan(width / 2);
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function asDailyRows(raw: unknown): { date: string; views: number; reach: number; followers: number | null }[] {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => {
    const row = item as { date: string; views: number; reach: number; followers: number | null };
    return { date: row.date, views: row.views, reach: row.reach, followers: row.followers };
  });
}
