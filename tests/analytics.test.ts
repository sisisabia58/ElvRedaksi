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
