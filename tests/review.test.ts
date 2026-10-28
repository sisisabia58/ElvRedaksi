import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { approveDraft, listDrafts, markPostedManually, postDraftNow, saveDraftText } from "../src/studio/drafts";

async function seedDraft(sql: Awaited<ReturnType<typeof createTestSql>>, dirty: boolean) {
  await seedDefaults(sql);
  await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
    "11111111-1111-1111-1111-111111111111",
    "Contoh",
    "https://news.example/feed",
    "ID",
  ]);
  await sql.rows(
    "insert into topics (id, source_id, title, url, state, score, sensitive) values ($1,$2,$3,$4,'drafted',84,true)",
    [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      "11111111-1111-1111-1111-111111111111",
      "Iklan",
      "https://news.example/a",
    ],
  );
  await sql.rows(
    `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty)
     values ($1,$2,'needs_review','teaser_bio','serif','[]'::jsonb,'cap','[]'::jsonb,'[]'::jsonb,'abcde',$3)`,
    ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", dirty],
  );
}

describe("review", () => {
  it("blocks approval after an edit until the slide is rendered again", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await saveDraftText(sql, "social_media", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", {
      slides: [{ role: "cover", kicker: "AI", headline: "Judul baru yang cukup", body: "Isi." }],
      caption: "Dari Contoh.",
      hashtags: ["iklan", "medsos", "sumber"],
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"],
      kicker: "AI",
    });
    await expect(approveDraft(sql, "social_media", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1")).rejects.toThrow(
      /Render dulu/,
    );
    await expect(postDraftNow(sql, "viewer", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1")).rejects.toThrow(/forbidden/);
  });

  it("lets a human mark a clean draft as posted without calling Meta", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await markPostedManually(sql, "admin", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1");
    const rows = await listDrafts(sql, "posted");
    expect(rows[0]).toMatchObject({ manual: true, sensitive: true, sourceName: "Contoh" });
    const jobs = await sql.rows("select id from jobs where name = 'publisher.publish'");
    expect(jobs).toHaveLength(0);
  });
});
