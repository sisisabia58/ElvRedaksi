import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/rss/parse";
import { excerptFromHtml, imageUrlFromHtml } from "../src/rss/excerpt";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { addSource, deleteSource, listSources } from "../src/studio/sources";
import { jobHandlers, runScout } from "../src/jobs/handlers";
import { enqueue, runDueJobs } from "../src/jobs/runner";
import { isBlockedFetchTarget, createPinnedLookup, PRIVATE_FETCH_MESSAGE } from "../src/rss/fetch-guard";

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
    const withImage = `<?xml version="1.0"?><rss><channel><item><title>Foto</title>
      <link>https://news.example/foto</link>
      <enclosure url="https://cdn.example/a.jpg" type="image/jpeg"/>
      <media:content url="https://cdn.example/ignored.jpg" medium="image"/>
      </item></channel></rss>`;
    expect(parseFeed(withImage)[0]?.imageUrl).toBe("https://cdn.example/a.jpg");
    const audio = `<?xml version="1.0"?><rss><channel><item><title>Audio</title>
      <link>https://news.example/audio</link>
      <enclosure url="https://cdn.example/a.mp3" type="audio/mpeg"/>
      </item></channel></rss>`;
    expect(parseFeed(audio)[0]?.imageUrl).toBeNull();
    const described = `<?xml version="1.0"?><rss><channel><item><title>Deskripsi</title>
      <link>https://news.example/desc</link>
      <description><![CDATA[<img src="https://img.antaranews.com/cache/800x533/a.jpg" /> Cuplikan foto.]]></description>
      </item></channel></rss>`;
    expect(parseFeed(described)[0]?.imageUrl).toBe("https://img.antaranews.com/cache/800x533/a.jpg");
    expect(
      imageUrlFromHtml(
        `<meta property="og:image" content="https://cdn.example/og.jpg"><img src="https://cdn.example/secret.jpg">`,
        "https://news.example/a",
      ),
    ).toBe("https://cdn.example/og.jpg");
    expect(
      imageUrlFromHtml(`<meta content="/img/rel.jpg" property="og:image">`, "https://news.example/a"),
    ).toBe("https://news.example/img/rel.jpg");
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

  it("fills a missing image on a known topic from the feed and does not refetch the article", async () => {
    const sql = await createTestSql();
    const sourceId = "11111111-1111-1111-1111-111111111111";
    const topicId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      sourceId,
      "ANTARA",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      topicId,
      sourceId,
      "KKP",
      "https://news.example/kkp",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'needs_review','carousel_full','berita_pro','[]'::jsonb,'c','[]'::jsonb,'[]'::jsonb,'kkp01')`,
      [draftId, topicId],
    );
    const feed = `<?xml version="1.0"?><rss><channel><item><title>KKP</title>
      <link>https://news.example/kkp</link>
      <enclosure url="https://cdn.example/kkp.jpg" type="image/jpeg"/>
      <description>Cuplikan.</description></item></channel></rss>`;
    let pageFetches = 0;
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-30T02:00:00Z"),
      fetchFeed: async () => feed,
      fetchPage: async () => {
        pageFetches += 1;
        return "<p>tidak boleh diambil</p>";
      },
    });
    expect(pageFetches).toBe(0);
    const topics = await sql.rows<{ image_url: string }>("select image_url from topics where id = $1", [topicId]);
    expect(topics[0]?.image_url).toBe("https://cdn.example/kkp.jpg");
    const drafts = await sql.rows<{ text_dirty: boolean }>("select text_dirty from drafts where id = $1", [draftId]);
    expect(drafts[0]?.text_dirty).toBe(true);
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-30T03:00:00Z"),
      fetchFeed: async () =>
        feed.replace("https://cdn.example/kkp.jpg", "https://cdn.example/other.jpg"),
      fetchPage: async () => {
        pageFetches += 1;
        return "";
      },
    });
    const again = await sql.rows<{ image_url: string }>("select image_url from topics where id = $1", [topicId]);
    expect(again[0]?.image_url).toBe("https://cdn.example/kkp.jpg");
    expect(pageFetches).toBe(0);
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

  it("does not insert a topic when the article fetch hits a private target", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await addSource(sql, "admin", { name: "Contoh", url: "https://news.example/feed", lang: "ID" });
    const feed = `<?xml version="1.0"?><rss><channel>
      <item><title>Rahasia</title><link>http://127.0.0.1/secret</link><description>Lokal.</description></item>
      <item><title>Publik</title><link>https://news.example/public</link><description>Luar.</description></item>
    </channel></rss>`;
    await runScout({
      sql,
      payload: {},
      manual: true,
      now: new Date("2026-10-28T01:00:00Z"),
      fetchFeed: async () => feed,
      fetchPage: async (url) => {
        if (url.includes("127.0.0.1")) {
          throw new Error(PRIVATE_FETCH_MESSAGE);
        }
        throw new Error("halaman gagal");
      },
    });
    const topics = await sql.rows<{ title: string; excerpt: string; url: string }>(
      "select title, excerpt, url from topics order by title",
    );
    expect(topics).toEqual([{ title: "Publik", excerpt: "", url: "https://news.example/public" }]);
  });
});
