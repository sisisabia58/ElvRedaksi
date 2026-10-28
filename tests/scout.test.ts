import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/rss/parse";
import { excerptFromHtml } from "../src/rss/excerpt";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { addSource, listSources } from "../src/studio/sources";
import { jobHandlers, runScout } from "../src/jobs/handlers";
import { enqueue, runDueJobs } from "../src/jobs/runner";
import { isBlockedFetchTarget, PRIVATE_FETCH_MESSAGE } from "../src/rss/fetch-guard";

const xml = `<?xml version="1.0"?><rss><channel>
  <item><title>Alat iklan baru</title><link>https://news.example/a</link>
    <pubDate>Wed, 28 Oct 2026 01:00:00 GMT</pubDate><description>Cuplikan.</description></item>
  <item><title>Duplikat</title><link>https://news.example/a</link><description></description></item>
</channel></rss>`;

describe("scout", () => {
  it("parses rss and ignores a second item with the same url", () => {
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Alat iklan baru", url: "https://news.example/a", summary: "Cuplikan." });
    expect(excerptFromHtml("<style>x</style><p>Halo <b>dunia</b></p><img src='https://news.example/a.jpg'>")).toBe(
      "Halo dunia",
    );
  });

  it("stores a topic, records an empty scan, and schedules the next one", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await addSource(sql, "admin", { name: "Contoh", url: "https://news.example/feed", lang: "ID" });
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-28T01:00:00Z"),
      fetchFeed: async () => xml,
      fetchPage: async () => "<article><p>Fakta dari sumber.</p><img src='https://cdn.example/secret.jpg'></article>",
    });
    const topics = await sql.rows<{ title: string; excerpt: string }>("select title, excerpt from topics");
    expect(topics).toEqual([{ title: "Alat iklan baru", excerpt: "Fakta dari sumber." }]);
    expect(JSON.stringify(topics)).not.toContain("secret.jpg");
    const activity = await sql.rows<{ message: string }>("select message from activity order by created_at");
    expect(activity.map((a) => a.message)).toContain("Menemukan 1 topik baru");
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-28T01:10:00Z"),
      fetchFeed: async () => xml,
      fetchPage: async () => "<p>Fakta dari sumber.</p>",
    });
    const again = await sql.rows<{ message: string }>("select message from activity order by created_at");
    expect(again.at(-1)?.message).toBe("Belum ada topik baru");
    const next = await sql.rows<{ name: string }>(
      "select name from jobs where finished_at is null and name = 'scout.scan'",
    );
    expect(next.length).toBeGreaterThan(0);
    const rows = await listSources(sql);
    expect(rows[0].topicCount).toBe(1);
    await expect(addSource(sql, "viewer", { name: "X", url: "https://x.example/feed", lang: "EN" })).rejects.toThrow(
      /forbidden/,
    );
  });

  it("queues the next scout.scan after runDueJobs finishes the in-flight job", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await addSource(sql, "admin", { name: "Contoh", url: "https://news.example/feed", lang: "ID" });
    const now = new Date("2026-10-28T10:00:00Z");
    await enqueue(sql, { name: "scout.scan", payload: {}, runAt: now, manual: false });

    const ran = await runDueJobs(sql, now, {
      workStart: "07:00",
      workEnd: "22:00",
      handlers: {
        ...jobHandlers,
        "scout.scan": (ctx) =>
          runScout({
            ...ctx,
            fetchFeed: async () => xml,
            fetchPage: async () => "<p>Fakta dari sumber.</p>",
          }),
      },
    });
    expect(ran).toBe(1);

    const scoutJobs = await sql.rows<{ finished_at: Date | null }>(
      "select finished_at from jobs where name = 'scout.scan' order by run_at",
    );
    expect(scoutJobs).toHaveLength(2);
    expect(scoutJobs[0]?.finished_at).not.toBeNull();
    expect(scoutJobs[1]?.finished_at).toBeNull();
  });

  it("rejects private fetch targets for feeds and skips private article urls", async () => {
    expect(isBlockedFetchTarget("http://127.0.0.1/feed")).toBe(true);
    expect(isBlockedFetchTarget("https://news.example/feed")).toBe(false);

    const sql = await createTestSql();
    await seedDefaults(sql);
    await addSource(sql, "admin", { name: "Lokal", url: "http://127.0.0.1/feed", lang: "ID" });
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-28T01:00:00Z"),
      fetchFeed: async () => {
        throw new Error("fetch should not run");
      },
      fetchPage: async () => "",
    });
    const rows = await listSources(sql);
    expect(rows[0]?.lastError).toMatch(new RegExp(PRIVATE_FETCH_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
