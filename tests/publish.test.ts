import { describe, expect, it } from "vitest";
import { FakePublisher, MetaPublisher } from "../src/publish/publisher";
import { pngToJpeg } from "../src/publish/jpeg";
import { createTestSql } from "../src/db/client";
import { runPublisher } from "../src/jobs/handlers";
import { weekItems } from "../src/studio/calendar";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("publisher", () => {
  it("transcodes a stored PNG into a JPEG Instagram can fetch", async () => {
    const jpeg = await pngToJpeg(ONE_BY_ONE_PNG);
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("stops when the Instagram quota is used up", async () => {
    const calls: string[] = [];
    let authorization = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      if (url.includes("content_publishing_limit")) {
        return json({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] });
      }
      return json({ id: "should-not-publish" });
    };
    const meta = new MetaPublisher(fetchImpl);
    await expect(
      meta.publish({
        igUserId: "1789",
        accessToken: "token",
        imageUrls: ["https://studio.example/media/1", "https://studio.example/media/2"],
        caption: "Dari Contoh",
        altTexts: ["satu", "dua"],
        shareToStory: false,
      }),
    ).rejects.toThrow(/Kuota posting/);
    expect(calls.some((url) => url.includes("/media_publish"))).toBe(false);
    const limit = calls.find((url) => url.includes("content_publishing_limit"));
    expect(limit).toBeTruthy();
    const fields = new URL(limit!).searchParams.get("fields") ?? "";
    expect(fields.split(",")).toEqual(expect.arrayContaining(["quota_usage", "config"]));
    expect(new URL(limit!).searchParams.has("access_token")).toBe(false);
    expect(authorization).toBe("Bearer token");
  });

  it("publishes a scheduled draft through the fake adapter", async () => {
    const sql = await createTestSql();
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111", "Contoh", "https://news.example/feed", "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "11111111-1111-1111-1111-111111111111", "Iklan", "https://news.example/a",
    ]);
    await sql.rows(
      "insert into ig_connection (id, ig_user_id, access_token, username) values (1,$1,$2,$3) on conflict (id) do update set ig_user_id = $1, access_token = $2, username = $3",
      ["1789", "token", "redaksi"],
    );
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, scheduled_at)
       values ($1,$2,'scheduled','teaser_bio','serif',$3::jsonb,'Dari Contoh','["a","b","c"]'::jsonb,'["Alt satu cukup","Alt dua cukup"]'::jsonb,'abcde',$4)`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        JSON.stringify([
          { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
        "2026-10-28T02:00:00Z",
      ],
    );
    await sql.rows("insert into assets (id, draft_id, slide_index, bytes) values ($1,$2,0,$3),($4,$2,1,$3)", [
      "cccccccc-cccc-cccc-cccc-ccccccccccc1",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
      Buffer.from("png"),
      "cccccccc-cccc-cccc-cccc-ccccccccccc2",
    ]);
    await runPublisher({
      sql,
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1" },
      manual: false,
      now: new Date("2026-10-28T02:00:00Z"),
      publisher: new FakePublisher(),
    });
    const row = await sql.rows<{ status: string; ig_media_id: string }>("select status, ig_media_id from drafts");
    expect(row[0].status).toBe("simulasi");
    expect(row[0].ig_media_id.startsWith("fake_")).toBe(true);
    const items = await weekItems(sql, new Date("2026-10-26T00:00:00Z"));
    expect(items).toHaveLength(0);
  });

  it("finishes a posting draft that already has an Instagram media id without publishing again", async () => {
    const sql = await createTestSql();
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
      "11111111-1111-1111-1111-111111111111",
      "Iklan",
      "https://news.example/b",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, ig_media_id, story_media_id, story_error)
       values ($1,$2,'posting','teaser_bio','serif',$3::jsonb,'Dari Contoh','[]'::jsonb,'[]'::jsonb,'alrdy','already','story-1','cerita gagal')`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
        JSON.stringify([
          { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
      ],
    );
    let publishCalls = 0;
    const now = new Date("2026-10-28T02:00:00Z");
    await runPublisher({
      sql,
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2" },
      manual: false,
      now,
      publisher: {
        async publish() {
          publishCalls += 1;
          throw new Error("publish must not be called");
        },
      },
    });
    const row = await sql.rows<{
      status: string;
      ig_media_id: string;
      story_media_id: string | null;
      story_error: string | null;
      posted_at: Date | string;
    }>("select status, ig_media_id, story_media_id, story_error, posted_at from drafts");
    expect(publishCalls).toBe(0);
    expect(row[0].status).toBe("posted");
    expect(row[0].ig_media_id).toBe("already");
    expect(row[0].story_media_id).toBe("story-1");
    expect(row[0].story_error).toBe("cerita gagal");
    expect(new Date(row[0].posted_at).toISOString()).toBe(now.toISOString());
  });

  async function postingDraft(sql: Awaited<ReturnType<typeof createTestSql>>, id: string) {
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
      "11111111-1111-1111-1111-111111111111",
      "Iklan",
      `https://news.example/${id}`,
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code)
       values ($1,$2,'posting','teaser_bio','serif',$3::jsonb,'Dari Contoh','[]'::jsonb,'[]'::jsonb,$4)`,
      [
        id,
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
        JSON.stringify([
          { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
        id.slice(0, 5),
      ],
    );
  }

  it("fails a retried posting draft that never stored an Instagram id", async () => {
    const sql = await createTestSql();
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3";
    await postingDraft(sql, draftId);
    let publishCalls = 0;
    await runPublisher({
      sql,
      payload: { draftId },
      manual: false,
      now: new Date("2026-10-28T02:00:00Z"),
      attempts: 1,
      reclaimed: false,
      publisher: {
        async publish() {
          publishCalls += 1;
          return { mediaId: "should-not", storyMediaId: null, storyError: null };
        },
      },
    });
    const row = await sql.rows<{ status: string; error: string | null; ig_media_id: string | null }>(
      "select status, error, ig_media_id from drafts",
    );
    expect(publishCalls).toBe(0);
    expect(row[0]).toMatchObject({
      status: "failed",
      error: "Posting terputus sebelum id Instagram tersimpan",
      ig_media_id: null,
    });
  });

  it("publishes a fresh posting draft that has no Instagram id yet", async () => {
    const sql = await createTestSql();
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4";
    await postingDraft(sql, draftId);
    const publisher = new FakePublisher();
    await runPublisher({
      sql,
      payload: { draftId },
      manual: true,
      now: new Date("2026-10-28T02:05:00Z"),
      attempts: 0,
      reclaimed: false,
      publisher,
    });
    expect(publisher.calls).toHaveLength(1);
    const row = await sql.rows<{ status: string; ig_media_id: string }>(
      "select status, ig_media_id from drafts",
    );
    expect(row[0].status).toBe("simulasi");
    expect(row[0].ig_media_id.startsWith("fake_")).toBe(true);
  });

  it("fails a reclaimed posting draft that never stored an Instagram id", async () => {
    const sql = await createTestSql();
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5";
    await postingDraft(sql, draftId);
    let publishCalls = 0;
    await runPublisher({
      sql,
      payload: { draftId },
      manual: false,
      now: new Date("2026-10-28T02:00:00Z"),
      attempts: 0,
      reclaimed: true,
      publisher: {
        async publish() {
          publishCalls += 1;
          return { mediaId: "should-not", storyMediaId: null, storyError: null };
        },
      },
    });
    expect(publishCalls).toBe(0);
    const row = await sql.rows<{ status: string; error: string | null }>("select status, error from drafts");
    expect(row[0]).toMatchObject({
      status: "failed",
      error: "Posting terputus sebelum id Instagram tersimpan",
    });
  });
});
