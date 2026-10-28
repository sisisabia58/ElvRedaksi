import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import type { Slide } from "../src/agents/copywriter";
import { coverUploadRejectionMessage, omitRejectedCoverPhoto } from "../src/studio/cover-photo";
import {
  approveDraft,
  bulkApproveDrafts,
  bulkRejectDrafts,
  bulkScheduleDrafts,
  countDraftsByStatus,
  listDrafts,
  markPostedManually,
  postDraftNow,
  rejectDraft,
  retryFailed,
  saveCoverPhoto,
  saveDraftText,
  saveFocal,
  scheduleDraft,
} from "../src/studio/drafts";
import { enqueue } from "../src/jobs/runner";

const DRAFT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const TOPIC_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

function pngDataUrl(byteLength: number): string {
  return `data:image/png;base64,${Buffer.alloc(byteLength, 7).toString("base64")}`;
}

async function insertDraft(
  sql: Awaited<ReturnType<typeof createTestSql>>,
  id: string,
  status: string,
  shortCode: string,
) {
  await sql.rows(
    `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty)
     values ($1,$2,$3,'teaser_bio','serif',$4::jsonb,'cap','[]'::jsonb,'[]'::jsonb,$5,false)`,
    [
      id,
      TOPIC_ID,
      status,
      JSON.stringify([{ role: "cover", kicker: "AI", headline: "Judul cukup panjang", body: "Isi." }]),
      shortCode,
    ],
  );
}

async function readDraft(sql: Awaited<ReturnType<typeof createTestSql>>, id: string) {
  const rows = await sql.rows<{
    status: string;
    text_dirty: boolean;
    focal_y: number;
    slides: string | { role: string; photoDataUrl?: string }[];
  }>("select status, text_dirty, focal_y, slides from drafts where id = $1", [id]);
  const row = rows[0];
  const slides = typeof row.slides === "string" ? JSON.parse(row.slides) : row.slides;
  return { ...row, slides: slides as { role: string; photoDataUrl?: string }[] };
}

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

  it("saves a cover under 2 MB and does not keep a photo that failed", async () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("4mb");
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await sql.rows(`update drafts set slides = $1::jsonb where id = $2`, [
      JSON.stringify([{ role: "cover", kicker: "AI", headline: "Judul lama cukup", body: "Isi." }]),
      DRAFT_ID,
    ]);
    const photo = pngDataUrl(1_500_000);
    await saveCoverPhoto(sql, "social_media", DRAFT_ID, photo);
    await saveDraftText(sql, "social_media", DRAFT_ID, {
      slides: [
        {
          role: "cover",
          kicker: "AI",
          headline: "Judul baru yang cukup",
          body: "Isi.",
          photoDataUrl: photo,
        } as Slide & { photoDataUrl: string },
      ],
      caption: "Dari Contoh.",
      hashtags: ["iklan"],
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"],
      kicker: "AI",
    });
    await enqueue(sql, {
      name: "designer.render",
      payload: { draftId: DRAFT_ID },
      runAt: new Date(),
      manual: true,
    });
    const saved = await readDraft(sql, DRAFT_ID);
    expect(saved.slides.find((slide) => slide.role === "cover")?.photoDataUrl).toBe(photo);
    const renders = await sql.rows("select id from jobs where name = 'designer.render'");
    expect(renders).toHaveLength(1);

    const tooBig = pngDataUrl(2 * 1024 * 1024 + 64);
    await expect(saveCoverPhoto(sql, "social_media", DRAFT_ID, tooBig)).rejects.toThrow(
      "Gambar maksimal 2 MB",
    );
    const afterReject = await readDraft(sql, DRAFT_ID);
    expect(afterReject.slides.find((slide) => slide.role === "cover")?.photoDataUrl).toBe(photo);

    const pending = [
      { role: "cover" as const, kicker: "AI", headline: "Judul", body: "Isi.", photoDataUrl: tooBig },
      { role: "point" as const, kicker: "", headline: "Lain", body: "" },
    ];
    const omitted = omitRejectedCoverPhoto(pending, tooBig);
    expect(omitted[0]).not.toHaveProperty("photoDataUrl");
    expect(omitRejectedCoverPhoto(pending, photo)[0]?.photoDataUrl).toBe(tooBig);
    expect(coverUploadRejectionMessage(new Error("Body exceeded 1 MB limit."))).toBe("Gambar maksimal 2 MB");
    expect(
      coverUploadRejectionMessage(new Error("An unexpected response was received from the server.")),
    ).toBe("Gambar maksimal 2 MB");
    expect(coverUploadRejectionMessage(new Error("Gambar harus PNG atau JPEG"))).toBe(
      "Gambar harus PNG atau JPEG",
    );
  });

  it("accepts a cover of exactly 2 MB and rejects one byte over", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await sql.rows(`update drafts set slides = $1::jsonb where id = $2`, [
      JSON.stringify([{ role: "cover", kicker: "AI", headline: "Judul lama cukup", body: "Isi." }]),
      DRAFT_ID,
    ]);
    const exact = pngDataUrl(2 * 1024 * 1024);
    expect(Buffer.from(exact.slice(exact.indexOf(",") + 1), "base64").length).toBe(2_097_152);
    await saveCoverPhoto(sql, "social_media", DRAFT_ID, exact);
    const saved = await readDraft(sql, DRAFT_ID);
    expect(saved.slides.find((slide) => slide.role === "cover")?.photoDataUrl).toBe(exact);

    const oneOver = pngDataUrl(2 * 1024 * 1024 + 1);
    expect(Buffer.from(oneOver.slice(oneOver.indexOf(",") + 1), "base64").length).toBe(2_097_153);
    await expect(saveCoverPhoto(sql, "social_media", DRAFT_ID, oneOver)).rejects.toThrow(
      "Gambar maksimal 2 MB",
    );
    const afterReject = await readDraft(sql, DRAFT_ID);
    expect(afterReject.slides.find((slide) => slide.role === "cover")?.photoDataUrl).toBe(exact);
  });

  it("lists only scheduled drafts and skips posting in bulk review actions", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    const scheduledId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
    const postingId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3";
    const reviewId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4";
    const scheduleId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5";
    const rejectId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6";
    await insertDraft(sql, scheduledId, "scheduled", "sched");
    await insertDraft(sql, postingId, "posting", "postn");
    await insertDraft(sql, reviewId, "needs_review", "revw1");
    await insertDraft(sql, scheduleId, "needs_review", "revw2");
    await insertDraft(sql, rejectId, "needs_review", "revw3");

    const listed = await listDrafts(sql, "scheduled");
    expect(listed.map((row) => row.id)).toEqual([scheduledId]);
    expect(listed.every((row) => row.status === "scheduled")).toBe(true);
    const counts = await countDraftsByStatus(sql);
    expect(listed).toHaveLength(counts.scheduled ?? 0);
    expect(counts.posting).toBe(1);

    const when = new Date(Date.now() + 3_600_000);
    await bulkApproveDrafts(sql, "social_media", [postingId, reviewId]);
    await bulkScheduleDrafts(sql, "social_media", [postingId, scheduleId], when);
    await bulkRejectDrafts(sql, "social_media", [postingId, rejectId]);

    expect((await readDraft(sql, postingId)).status).toBe("posting");
    expect((await readDraft(sql, reviewId)).status).toBe("approved");
    expect((await readDraft(sql, scheduleId)).status).toBe("scheduled");
    expect((await readDraft(sql, rejectId)).status).toBe("rejected");
    const jobs = await sql.rows<{ payload: { draftId?: string } | string }>(
      "select payload from jobs where name = 'publisher.publish'",
    );
    const draftIds = jobs.map((job) => {
      const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
      return payload.draftId as string;
    });
    expect(draftIds).toEqual([scheduleId]);
  });

  it("lists the cover headline without selecting photoDataUrl bytes", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    const photo = pngDataUrl(2 * 1024 * 1024);
    await sql.rows(`update drafts set slides = $1::jsonb where id = $2`, [
      JSON.stringify([
        {
          role: "cover",
          kicker: "AI",
          headline: "Judul cukup panjang",
          body: "Isi.",
          photoDataUrl: photo,
        },
        { role: "cta", kicker: "Sumber", headline: "Baca lengkapnya di link bio", body: "Ke artikel." },
      ]),
      DRAFT_ID,
    ]);
    const listed = await listDrafts(sql, "needs_review");
    expect(listed[0]).toMatchObject({ headline: "Judul cukup panjang", slideCount: 2 });
    expect(listDrafts.toString()).toContain("- 'photoDataUrl'");
    const stored = await readDraft(sql, DRAFT_ID);
    expect(stored.slides.find((slide) => slide.role === "cover")?.photoDataUrl).toBe(photo);
  });

  it("persists focal only when the value changed", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await saveFocal(sql, "social_media", DRAFT_ID, 50);
    expect(await readDraft(sql, DRAFT_ID)).toMatchObject({
      status: "needs_review",
      text_dirty: false,
      focal_y: 50,
    });
    const when = new Date(Date.now() + 3_600_000);
    await approveDraft(sql, "social_media", DRAFT_ID);
    await scheduleDraft(sql, "social_media", DRAFT_ID, when);
    await postDraftNow(sql, "social_media", DRAFT_ID);
    expect(await readDraft(sql, DRAFT_ID)).toMatchObject({
      status: "posting",
      text_dirty: false,
      focal_y: 50,
    });

    const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
    await insertDraft(sql, other, "needs_review", "focal");
    await saveFocal(sql, "social_media", other, 12);
    expect(await readDraft(sql, other)).toMatchObject({ text_dirty: true, focal_y: 12 });
    await expect(approveDraft(sql, "social_media", other)).rejects.toThrow(/Render dulu/);
    await expect(scheduleDraft(sql, "social_media", other, when)).rejects.toThrow(/Render dulu/);
    await expect(postDraftNow(sql, "social_media", other)).rejects.toThrow(/Render dulu/);
  });
});
