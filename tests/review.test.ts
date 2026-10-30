import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { createTestSql } from "../src/db/client";
import { seedDefaults } from "../src/db/seed";
import type { Slide } from "../src/agents/copywriter";
import { coverUploadRejectionMessage, omitRejectedCoverPhoto } from "../src/studio/cover-photo";
import {
  adoptServerDraft,
  editorPublishBlocked,
  editorTextFields,
  focalSliderIsUnsaved,
  readPreviewFields,
  switchPreviewFormat,
  writePreviewFields,
  type EditorTextFields,
} from "../src/studio/editor-sync";
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
  setTemplate,
} from "../src/studio/drafts";
import type { Sql } from "../src/db/client";
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
    slides: string | { role: string; headline?: string; photoDataUrl?: string }[];
  }>("select status, text_dirty, focal_y, slides from drafts where id = $1", [id]);
  const row = rows[0];
  const slides = typeof row.slides === "string" ? JSON.parse(row.slides) : row.slides;
  return { ...row, slides: slides as { role: string; headline?: string; photoDataUrl?: string }[] };
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

  it("pulls a scheduled draft back to review and cancels its publisher when text is saved", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await sql.rows(`update drafts set status = 'scheduled' where id = $1`, [DRAFT_ID]);
    await enqueue(sql, {
      name: "publisher.publish",
      payload: { draftId: DRAFT_ID },
      runAt: new Date(Date.now() + 3_600_000),
    });
    await saveDraftText(sql, "social_media", DRAFT_ID, {
      slides: [{ role: "cover", kicker: "AI", headline: "Judul baru yang cukup", body: "Isi." }],
      caption: "Dari Contoh.",
      hashtags: ["iklan"],
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"],
      kicker: "AI",
    });
    expect(await readDraft(sql, DRAFT_ID)).toMatchObject({
      status: "needs_review",
      text_dirty: true,
    });
    const jobs = await sql.rows(
      `select id from jobs
       where name = 'publisher.publish' and finished_at is null and payload->>'draftId' = $1`,
      [DRAFT_ID],
    );
    expect(jobs).toHaveLength(0);
  });

  it("does not write when saveFocal repeats the stored focal on a scheduled draft", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await sql.rows(`update drafts set status = 'scheduled', focal_y = 40 where id = $1`, [DRAFT_ID]);
    await enqueue(sql, {
      name: "publisher.publish",
      payload: { draftId: DRAFT_ID },
      runAt: new Date(Date.now() + 3_600_000),
    });
    await saveFocal(sql, "social_media", DRAFT_ID, 40);
    expect(await readDraft(sql, DRAFT_ID)).toMatchObject({
      status: "scheduled",
      text_dirty: false,
      focal_y: 40,
    });
    const jobs = await sql.rows(
      `select id from jobs
       where name = 'publisher.publish' and finished_at is null and payload->>'draftId' = $1`,
      [DRAFT_ID],
    );
    expect(jobs).toHaveLength(1);
  });

  it("does not write when setTemplate repeats the stored template on a scheduled draft", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    await sql.rows(`update drafts set status = 'scheduled' where id = $1`, [DRAFT_ID]);
    await enqueue(sql, {
      name: "publisher.publish",
      payload: { draftId: DRAFT_ID },
      runAt: new Date(Date.now() + 3_600_000),
    });
    await setTemplate(sql, "social_media", DRAFT_ID, "serif");
    expect(await readDraft(sql, DRAFT_ID)).toMatchObject({
      status: "scheduled",
      text_dirty: false,
    });
    const jobs = await sql.rows(
      `select id from jobs
       where name = 'publisher.publish' and finished_at is null and payload->>'draftId' = $1`,
      [DRAFT_ID],
    );
    expect(jobs).toHaveLength(1);
  });

  it("rejects a text save while the draft is posting", async () => {
    const sql = await createTestSql();
    await seedDraft(sql, false);
    const headline = "Judul yang sudah disetujui";
    await sql.rows(
      `update drafts set status = 'posting', text_dirty = false, slides = $2::jsonb where id = $1`,
      [
        DRAFT_ID,
        JSON.stringify([{ role: "cover", kicker: "AI", headline, body: "Isi." }]),
      ],
    );
    await enqueue(sql, {
      name: "publisher.publish",
      payload: { draftId: DRAFT_ID },
      runAt: new Date(),
      manual: true,
    });
    await expect(
      saveDraftText(sql, "social_media", DRAFT_ID, {
        slides: [{ role: "cover", kicker: "AI", headline: "Judul baru yang cukup", body: "Isi." }],
        caption: "Dari Contoh.",
        hashtags: ["iklan"],
        altHeadlines: ["Alt satu cukup", "Alt dua cukup"],
        kicker: "AI",
      }),
    ).rejects.toThrow("Draf sedang diposting");
    const draft = await readDraft(sql, DRAFT_ID);
    expect(draft).toMatchObject({
      status: "posting",
      text_dirty: false,
    });
    expect(draft.slides[0]?.headline).toBe(headline);
    const jobs = await sql.rows(
      `select id from jobs
       where name = 'publisher.publish' and finished_at is null and payload->>'draftId' = $1`,
      [DRAFT_ID],
    );
    expect(jobs).toHaveLength(1);
  });

  it("does not cancel the publisher when a locked text save matches no row", async () => {
    const statements: string[] = [];
    const slides = [{ role: "cover" as const, kicker: "AI", headline: "Judul cukup panjang", body: "Isi." }];
    const fake: Sql = {
      async rows<T>(text: string): Promise<T[]> {
        statements.push(text);
        if (/^\s*select/i.test(text)) {
          return [
            {
              id: DRAFT_ID,
              status: "scheduled",
              format: "teaser_bio",
              template: "serif",
              slides,
              focal_y: 50,
            },
          ] as T[];
        }
        return [] as T[];
      },
      async tx(fn) {
        return fn(fake);
      },
    };
    await saveDraftText(fake, "social_media", DRAFT_ID, {
      slides,
      caption: "Dari Contoh.",
      hashtags: ["iklan"],
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"],
      kicker: "AI",
    });
    expect(statements.some((sql) => /for update/i.test(sql))).toBe(true);
    const update = statements.find((sql) => /update drafts/i.test(sql));
    expect(update).toMatch(/where id = \$\d+ and status = \$\d+/i);
    expect(statements.some((sql) => /delete from jobs/i.test(sql))).toBe(false);
  });

  it("binds kicker, headline, and body to the preview slide and leaves the others", () => {
    const cover = { role: "cover" as const, kicker: "AI", headline: "Judul cover cukup", body: "Cover." };
    const point = { role: "point" as const, kicker: "Fakta", headline: "Poin yang sedang tampil", body: "Detail poin." };
    const pointTwo = { role: "point" as const, kicker: "Dampak", headline: "Poin kedua cukup", body: "Detail dua." };
    const cta = { role: "cta" as const, kicker: "Sumber", headline: "Baca lengkapnya di bio", body: "Ke Contoh." };
    const slides = [cover, point, pointTwo, cta];
    const draft = {
      slides,
      format: "carousel_full" as const,
      caption: "Caption dari Contoh.",
      hashtags: ["iklan"],
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"] as [string, string],
    };
    expect(readPreviewFields("carousel_full", slides, 1)).toEqual({
      kicker: point.kicker,
      headline: point.headline,
      body: point.body,
    });
    expect(editorTextFields(draft, 1).headline).toBe(point.headline);
    const savedPoint = writePreviewFields("carousel_full", slides, 1, {
      kicker: "Fakta",
      headline: "Poin sudah dikoreksi",
      body: "Detail baru.",
    });
    expect(savedPoint[0]).toEqual(cover);
    expect(savedPoint[2]).toEqual(pointTwo);
    expect(savedPoint[3]).toEqual(cta);
    expect(savedPoint[1]).toMatchObject({ headline: "Poin sudah dikoreksi", body: "Detail baru." });

    expect(readPreviewFields("teaser_bio", slides, 1).headline).toBe(cta.headline);
    const savedCta = writePreviewFields("teaser_bio", slides, 1, {
      kicker: cta.kicker,
      headline: "CTA yang dikoreksi",
      body: cta.body,
    });
    expect(savedCta[1]).toEqual(point);
    expect(savedCta[2]).toEqual(pointTwo);
    expect(savedCta[0]).toEqual(cover);
    expect(savedCta[3].headline).toBe("CTA yang dikoreksi");

    const previous = editorTextFields(draft, 1);
    const nextSlides = [
      { ...cover, headline: "Cover dari server" },
      { ...point, kicker: "Baru", headline: "Poin dari server", body: "Server." },
      pointTwo,
      cta,
    ];
    const next = editorTextFields({ ...draft, slides: nextSlides }, 1);
    expect(adoptServerDraft(previous, previous, next, { format: "carousel_full", index: 1 })).toMatchObject({
      kicker: "Baru",
      headline: "Poin dari server",
      body: "Server.",
    });
    const dirty = { ...previous, headline: "Sedang saya ketik poin" };
    const adopted = adoptServerDraft(previous, dirty, next, { format: "carousel_full", index: 1 });
    expect(adopted.headline).toBe("Sedang saya ketik poin");
    expect(adopted.kicker).toBe(point.kicker);
    expect(adopted.body).toBe(point.body);
    expect(adopted.slides[0]).toMatchObject({ headline: "Cover dari server" });
    expect(adopted.slides[1]).toMatchObject({
      kicker: point.kicker,
      headline: "Sedang saya ketik poin",
      body: point.body,
    });
    expect(adopted.slides[2]).toEqual(pointTwo);
    expect(adopted.slides[3]).toEqual(cta);
    expect(adopted.headline).not.toBe(nextSlides[0].headline);
  });

  it("adopts a server rewrite when local fields are unchanged and keeps dirty ones", () => {
    const previous: EditorTextFields = {
      slides: [{ role: "cover", kicker: "AI", headline: "Judul lama cukup", body: "Lama." }],
      kicker: "AI",
      headline: "Judul lama cukup",
      body: "Lama.",
      caption: "Caption lama dari Contoh.",
      hashtagsText: "iklan, medsos",
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"],
    };
    const next: EditorTextFields = {
      slides: [{ role: "cover", kicker: "Baru", headline: "Judul baru yang cukup", body: "Baru." }],
      kicker: "Baru",
      headline: "Judul baru yang cukup",
      body: "Baru.",
      caption: "Caption baru dari Contoh.",
      hashtagsText: "baru, tag, sumber",
      altHeadlines: ["Alt tiga cukup", "Alt empat cukup"],
    };
    expect(adoptServerDraft(previous, previous, next)).toEqual(next);
    const dirty: EditorTextFields = { ...previous, headline: "Sedang saya ketik" };
    const adopted = adoptServerDraft(previous, dirty, next);
    expect(adopted.headline).toBe("Sedang saya ketik");
    expect(adopted.kicker).toBe(previous.kicker);
    expect(adopted.body).toBe(previous.body);
    expect(adopted.slides).toEqual([
      { role: "cover", kicker: previous.kicker, headline: "Sedang saya ketik", body: previous.body },
    ]);
    expect(adopted.caption).toBe(next.caption);
    expect(adopted.hashtagsText).toBe(next.hashtagsText);
    expect(adopted.altHeadlines).toEqual(next.altHeadlines);
  });

  it("keeps an edited point on its slide when the format changes", () => {
    const cover = { role: "cover" as const, kicker: "AI", headline: "Judul cover cukup", body: "Cover." };
    const point = { role: "point" as const, kicker: "Fakta", headline: "Poin yang sedang tampil", body: "Detail poin." };
    const cta = { role: "cta" as const, kicker: "Sumber", headline: "Baca lengkapnya di bio", body: "Ke Contoh." };
    const changed = switchPreviewFormat({
      slides: [cover, point, cta],
      fromFormat: "carousel_full",
      toFormat: "teaser_bio",
      previewIndex: 1,
      kicker: point.kicker,
      headline: "POIN",
      body: point.body,
    });
    expect(changed.index).toBe(0);
    expect(changed.headline).toBe(cover.headline);
    expect(changed.kicker).toBe(cover.kicker);
    expect(changed.body).toBe(cover.body);
    expect(changed.slides[1]?.headline).toBe("POIN");
    expect(changed.slides[0]).toEqual(cover);
    expect(changed.slides[2]).toEqual(cta);
  });

  it("adopts rewrites of untouched slides and keeps the slide that was edited", () => {
    const previousSlides: Slide[] = [
      { role: "cover", kicker: "ck", headline: "A", body: "ca" },
      { role: "point", kicker: "pk", headline: "B", body: "pb" },
      { role: "cta", kicker: "tk", headline: "C", body: "cb" },
    ];
    const nextSlides: Slide[] = [
      { role: "cover", kicker: "ck2", headline: "A2", body: "ca2" },
      { role: "point", kicker: "pk9", headline: "B9", body: "pb9" },
      { role: "cta", kicker: "tk2", headline: "C2", body: "cb2" },
    ];
    const meta = {
      format: "carousel_full" as const,
      caption: "Caption dari Contoh.",
      hashtags: ["iklan"],
      altHeadlines: ["Alt satu cukup", "Alt dua cukup"] as [string, string],
    };
    const previousPoint = editorTextFields({ ...meta, slides: previousSlides }, 1);
    const nextPoint = editorTextFields(
      { ...meta, slides: nextSlides, caption: "Caption baru dari Contoh." },
      1,
    );
    const viewingPoint = adoptServerDraft(
      previousPoint,
      { ...previousPoint, headline: "B2" },
      nextPoint,
      { format: "carousel_full", index: 1 },
    );
    expect(viewingPoint.slides.map((slide) => slide.headline)).toEqual(["A2", "B2", "C2"]);
    expect(viewingPoint.slides[0]).toEqual(nextSlides[0]);
    expect(viewingPoint.slides[1]).toEqual({ role: "point", kicker: "pk", headline: "B2", body: "pb" });
    expect(viewingPoint.slides[2]).toEqual(nextSlides[2]);
    expect(viewingPoint.headline).toBe("B2");
    expect(viewingPoint.caption).toBe("Caption baru dari Contoh.");
    expect(readPreviewFields("carousel_full", viewingPoint.slides, 1).headline).toBe("B2");
    expect(readPreviewFields("carousel_full", viewingPoint.slides, 0).headline).toBe("A2");

    const previousCover = editorTextFields({ ...meta, slides: previousSlides }, 0);
    const nextCover = editorTextFields({ ...meta, slides: nextSlides }, 0);
    const localSlides = previousSlides.map((slide) =>
      slide.role === "point" ? { ...slide, headline: "B2" } : slide,
    );
    const viewingCover = adoptServerDraft(
      previousCover,
      { ...previousCover, slides: localSlides },
      nextCover,
      { format: "carousel_full", index: 0 },
    );
    expect(viewingCover.headline).toBe("A2");
    expect(readPreviewFields("carousel_full", viewingCover.slides, 0).headline).toBe("A2");
    expect(readPreviewFields("carousel_full", viewingCover.slides, 1).headline).toBe("B2");
    expect(viewingCover.slides.map((slide) => slide.headline)).toEqual(["A2", "B2", "C2"]);
  });

  it("treats a focal slider that differs from the saved value as unsaved", () => {
    expect(focalSliderIsUnsaved(50, 50)).toBe(false);
    expect(focalSliderIsUnsaved(50, 50.4)).toBe(false);
    expect(focalSliderIsUnsaved(50, 62)).toBe(true);
    expect(focalSliderIsUnsaved(0, -3)).toBe(false);
    expect(focalSliderIsUnsaved(100, 140)).toBe(false);
    expect(
      editorPublishBlocked({
        textDirty: false,
        hasUnsavedTextEdits: false,
        savedFocal: 50,
        sliderFocal: 62,
      }),
    ).toBe(true);
    expect(
      editorPublishBlocked({
        textDirty: false,
        hasUnsavedTextEdits: false,
        savedFocal: 50,
        sliderFocal: 50,
      }),
    ).toBe(false);
    expect(
      editorPublishBlocked({
        textDirty: true,
        hasUnsavedTextEdits: false,
        savedFocal: 50,
        sliderFocal: 50,
      }),
    ).toBe(true);
    expect(
      editorPublishBlocked({
        textDirty: false,
        hasUnsavedTextEdits: true,
        savedFocal: 50,
        sliderFocal: 50,
      }),
    ).toBe(true);
    expect(
      editorPublishBlocked({
        textDirty: false,
        hasUnsavedTextEdits: false,
        savedFocal: 50,
        sliderFocal: 50,
        awaitingRewrite: true,
      }),
    ).toBe(true);
  });

  it("keeps placeholder copy in review and refuses approval", async () => {
    const sql = await createTestSql();
    await seedDefaults(sql);
    await sql.rows("insert into sources (id, name, url, lang) values ($1,$2,$3,$4)", [
      "11111111-1111-1111-1111-111111111111",
      "Contoh",
      "https://news.example/feed",
      "ID",
    ]);
    await sql.rows("insert into topics (id, source_id, title, url) values ($1,$2,$3,$4)", [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      "11111111-1111-1111-1111-111111111111",
      "Demo",
      "https://news.example/demo",
    ]);
    await sql.rows(
      `insert into drafts (id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, short_code, text_dirty)
       values ($1,$2,'needs_review','carousel_full','berita_pro',$3::jsonb,'cap','[]'::jsonb,'[]'::jsonb,'demo1',false)`,
      [
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        JSON.stringify([
          { role: "cover", kicker: "AI", headline: "Judul demo yang lama", body: "Satu kalimat pembuka." },
        ]),
      ],
    );
    const listed = await listDrafts(sql, "needs_review");
    expect(listed[0]?.awaitingRewrite).toBe(true);
    await expect(approveDraft(sql, "admin", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1")).rejects.toThrow(
      /menunggu tulis ulang/,
    );
    await expect(
      scheduleDraft(sql, "admin", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1", new Date("2026-11-02T02:00:00Z")),
    ).rejects.toThrow(/menunggu tulis ulang/);
    const still = await sql.rows<{ status: string }>(
      "select status from drafts where id = $1",
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"],
    );
    expect(still[0]?.status).toBe("needs_review");
  });
});
