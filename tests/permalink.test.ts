import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { fetchInstagramPermalink, readPermalink } from "../src/instagram/permalink";
import { runPublisher } from "../src/jobs/handlers";

describe("instagram permalink", () => {
  it("accepts an https Instagram post URL and rejects anything else", () => {
    expect(readPermalink({ permalink: "https://www.instagram.com/p/DfJ4yWBmIUp/" })).toBe(
      "https://www.instagram.com/p/DfJ4yWBmIUp/",
    );
    expect(readPermalink({ permalink: "http://www.instagram.com/p/abc/" })).toBeNull();
    expect(readPermalink({ permalink: "https://example.com/p/abc/" })).toBeNull();
    expect(readPermalink({ permalink: "javascript:alert(1)" })).toBeNull();
  });

  it("stores a permalink for a finished post and still finishes when the lookup fails", async () => {
    const sql = await createTestSql();
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9",
      "11111111-1111-1111-1111-111111111111",
      "Iklan",
      "https://news.example/permalink",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, ig_media_id)
       values ($1,$2,'posting','teaser_bio','serif',$3::jsonb,'Dari Contoh','[]'::jsonb,'[]'::jsonb,'plink','179101')`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9",
        JSON.stringify([
          { role: "cover", kicker: "AI", headline: "Iklan baru bisa nyamar", body: "Pembuka." },
          { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke Contoh." },
        ]),
      ],
    );
    await sql.rows(
      `update ig_connection set ig_user_id = '1789', access_token = 'tok-plain', api_host = 'facebook' where id = 1`,
    );
    let publishCalls = 0;
    await runPublisher({
      sql,
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9" },
      manual: false,
      now: new Date("2026-10-31T09:57:24Z"),
      publisher: {
        async publish() {
          publishCalls += 1;
          throw new Error("publish must not be called");
        },
      },
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("fields")).toBe("permalink");
        expect(url.searchParams.has("access_token")).toBe(false);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok-plain");
        return new Response(JSON.stringify({ permalink: "https://www.instagram.com/p/DfJ4yWBmIUp/" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(publishCalls).toBe(0);
    const row = await sql.rows<{ status: string; ig_permalink: string }>(
      "select status, ig_permalink from drafts",
    );
    expect(row[0]).toMatchObject({
      status: "posted",
      ig_permalink: "https://www.instagram.com/p/DfJ4yWBmIUp/",
    });

    await sql.rows(`update drafts set status = 'posting', ig_permalink = null where id = $1`, [
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9",
    ]);
    await runPublisher({
      sql,
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9" },
      manual: false,
      now: new Date("2026-10-31T09:58:00Z"),
      publisher: {
        async publish() {
          throw new Error("publish must not be called");
        },
      },
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    const again = await sql.rows<{ status: string; ig_permalink: string | null }>(
      "select status, ig_permalink from drafts",
    );
    expect(again[0].status).toBe("posted");
    expect(again[0].ig_permalink).toBeNull();
  });

  it("does not call the network for a fake media id", async () => {
    let calls = 0;
    const permalink = await fetchInstagramPermalink(
      async () => {
        calls += 1;
        throw new Error("fake ids stay local");
      },
      "fake_1",
      "tok-plain",
      "facebook",
    );
    expect(permalink).toBeNull();
    expect(calls).toBe(0);
  });
});
