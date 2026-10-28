import { describe, expect, it } from "vitest";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import { approveDraft, listDrafts, markPostedManually, postDraftNow, rejectDraft, retryFailed, saveCoverPhoto, saveDraftText, scheduleDraft } from "../src/studio/drafts";
import { enqueue } from "../src/jobs/runner";

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

  it("keeps cover photoDataUrl when saveDraftText omits it", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    const photo = "data:image/png;base64,iVBORw0KGgo";
    await sql.rows(`update drafts set slides = $1::jsonb where id = $2`, [
      JSON.stringify([{ role: "cover", kicker: "AI", headline: "Judul lama cukup", body: "Isi." }]),
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
    ]);
    await saveCoverPhoto(sql, "social_media", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", photo);
    await saveDraftText(sql, "social_media", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", {
      slides: [{ role: "cover", kicker: "AI", headline: "Judul baru yang cukup", body: "Isi." }],
      caption: "Dari Contoh.",
      hashtags: ["iklan"],
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"],
      kicker: "AI",
    });
    const rows = await sql.rows<{ slides: string }>("select slides from drafts where id = $1", [
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
    ]);
    const raw = rows[0].slides;
    const stored = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      role: string;
      photoDataUrl?: string;
    }[];
    expect(stored.find((s) => s.role === "cover")?.photoDataUrl).toBe(photo);
  });

  it("cancels scheduled publish jobs when rejecting", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await sql.rows(`update drafts set status = 'scheduled' where id = $1`, [
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
    ]);
    await enqueue(sql, {
      name: "publisher.publish",
      payload: { draftId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1" },
      runAt: new Date(Date.now() + 3600_000),
    });
    await rejectDraft(sql, "social_media", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1");
    const jobs = await sql.rows("select id from jobs where name = 'publisher.publish'");
    expect(jobs).toHaveLength(0);
  });

  it("does not enqueue twice when retry is called after posting", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await sql.rows(`update drafts set status = 'failed', error = 'gagal' where id = $1`, [
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
    ]);
    await retryFailed(sql, "admin", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1");
    await expect(retryFailed(sql, "admin", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1")).rejects.toThrow();
    const jobs = await sql.rows("select id from jobs where name = 'publisher.publish'");
    expect(jobs).toHaveLength(1);
  });

  it("cancels scheduled publish jobs when marked posted manually", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    const draftId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
    const runAt = new Date(Date.now() + 3600_000);
    await scheduleDraft(sql, "admin", draftId, runAt);
    await markPostedManually(sql, "admin", draftId);
    const status = await sql.rows<{ status: string }>("select status from drafts where id = $1", [draftId]);
    expect(status[0]?.status).toBe("posted");
    const jobs = await sql.rows(
      `select id from jobs
       where name = 'publisher.publish'
         and finished_at is null
         and payload->>'draftId' = $1`,
      [draftId],
    );
    expect(jobs).toHaveLength(0);
  });
});
