import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/rss/parse";
import { excerptFromHtml } from "../src/rss/excerpt";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { addSource, deleteSource, listSources } from "../src/studio/sources";
import { jobHandlers, runScout } from "../src/jobs/handlers";
import { enqueue, runDueJobs } from "../src/jobs/runner";
import { isBlockedFetchTarget, createPinnedLookup } from "../src/rss/fetch-guard";

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
    const inlineXml = `<?xml version="1.0"?><rss><channel><item><title>T</title><link>https://news.example/b</link>
      <description>Halo <b>dunia</b> indah</description></item></channel></rss>`;
    const inline = parseFeed(inlineXml);
    expect(inline[0]?.summary).toBe("Halo dunia indah");
    expect(excerptFromHtml("<style>x</style><p>Halo <b>dunia</b></p><img src='https://news.example/a.jpg'>")).toBe(
      "Halo dunia",
    );
    const atomXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title>
      <link href="https://news.example/atom-1" rel="alternate"/></entry></feed>`;
    const atomItems = parseFeed(atomXml);
    expect(atomItems[0]?.url).toBe("https://news.example/atom-1");
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
    await expect(addSource(sql, "admin", { name: "  ", url: "https://news.example/feed", lang: "ID" })).rejects.toThrow(
      /Nama 2/,
    );
    await expect(addSource(sql, "admin", { name: " a", url: "https://news.example/feed", lang: "ID" })).rejects.toThrow(
      /Nama 2/,
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
    expect(await isBlockedFetchTarget("http://127.0.0.1/feed")).toBe(true);
    expect(await isBlockedFetchTarget("http://10.0.0.1/")).toBe(true);
    expect(await isBlockedFetchTarget("http://172.16.0.1/")).toBe(true);
    expect(await isBlockedFetchTarget("http://192.168.0.1/")).toBe(true);
    expect(await isBlockedFetchTarget("http://169.254.169.254/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[::1]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[::ffff:127.0.0.1]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[::ffff:7f00:1]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[::ffff:169.254.169.254]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://0.1.2.3/")).toBe(true);
    expect(await isBlockedFetchTarget("http://100.64.0.1/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[::]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[2002:7f00:1::]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[64:ff9b::7f00:1]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[fd12:3456:789a:1:2:3:4:5]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[::169.254.169.254]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[::ffff:0:169.254.169.254]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[2001::a9fe:a9fe]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[64:ff9b:1::a9fe:a9fe]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://224.0.0.1/")).toBe(true);
    expect(await isBlockedFetchTarget("http://[ff02::1]/")).toBe(true);
    expect(await isBlockedFetchTarget("http://1.1.1.1/")).toBe(false);

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
    expect(rows[0]?.lastError).toMatch(/fetch should not run/);
  });

  it("returns undici all:true lookup entries for pinned addresses", async () => {
    const pinned = "203.0.113.9";
    const lookup = createPinnedLookup("feed.example.com", [pinned]);
    const results = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      lookup("feed.example.com", { all: true }, (err, addresses) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(addresses as { address: string; family: number }[]);
      });
    });
    expect(results[0]?.address).toBe(pinned);
    expect(results[0]?.family).toBe(4);
  });

  it("does not fetch article pages for topic urls that already exist", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await addSource(sql, "admin", { name: "Contoh", url: "https://news.example/feed", lang: "ID" });
    let pageFetches = 0;
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-28T01:00:00Z"),
      fetchFeed: async () => xml,
      fetchPage: async () => {
        pageFetches += 1;
        return "<p>Fakta dari sumber.</p>";
      },
    });
    expect(pageFetches).toBe(1);
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-28T01:20:00Z"),
      fetchFeed: async () => xml,
      fetchPage: async () => {
        pageFetches += 1;
        throw new Error("should not refetch known article");
      },
    });
    expect(pageFetches).toBe(1);
  });

  it("deletes a source after topics have drafts", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    const sourceId = "11111111-1111-1111-1111-111111111111";
    const topicId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      sourceId,
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      topicId,
      sourceId,
      "Judul",
      "https://news.example/a",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'drafted','teaser_bio','serif','[]'::jsonb,'c','[]'::jsonb,'[]'::jsonb,$3)`,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", topicId, "code1"],
    );
    await deleteSource(sql, "admin", sourceId);
    const sources = await sql.rows<{ id: string }>("select id from sources where id = $1", [sourceId]);
    const topics = await sql.rows<{ id: string }>("select id from topics where source_id = $1", [sourceId]);
    const drafts = await sql.rows<{ id: string }>("select id from drafts where topic_id = $1", [topicId]);
    expect(sources).toHaveLength(0);
    expect(topics).toHaveLength(0);
    expect(drafts).toHaveLength(0);
  });
});
