import type { Slide } from "../agents/copywriter";
import { can, type Role } from "../auth/rbac";
import type { Sql } from "../db/client";
import { assertTransition, type DraftStatus } from "../domain/status";
import { slidesForFormat } from "../render/html";
import { enqueue } from "../jobs/runner";

const COVER_PHOTO_DATA_URL =
  /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_COVER_PHOTO_BYTES = 2 * 1024 * 1024;

function validateCoverPhotoDataUrl(photoDataUrl: string): string {
  if (photoDataUrl.trim() !== photoDataUrl || /[\s"']/.test(photoDataUrl)) {
    throw new Error("Format gambar tidak valid");
  }
  if (!COVER_PHOTO_DATA_URL.test(photoDataUrl)) {
    throw new Error("Gambar harus PNG atau JPEG");
  }
  const base64 = photoDataUrl.slice(photoDataUrl.indexOf(",") + 1);
  const byteLength = Math.floor((base64.length * 3) / 4);
  if (byteLength > MAX_COVER_PHOTO_BYTES) {
    throw new Error("Gambar maksimal 2 MB");
  }
  return photoDataUrl;
}

export type DraftCard = {
  id: string;
  status: DraftStatus;
  format: "carousel_full" | "teaser_bio";
  template: "stabilo" | "foto_penuh" | "serif" | "catatan";
  score: number | null;
  sensitive: boolean;
  headline: string;
  sourceName: string;
  shortCode: string;
  clickCount: number;
  updatedAt: Date;
  manual: boolean;
  assetId: string | null;
  slideCount: number;
  handle: string;
};

export type DraftDetail = {
  id: string;
  topicId: string;
  status: DraftStatus;
  format: "carousel_full" | "teaser_bio";
  template: "stabilo" | "foto_penuh" | "serif" | "catatan";
  slides: Slide[];
  caption: string;
  hashtags: string[];
  altHeadlines: [string, string];
  focalY: number;
  shortCode: string;
  clickCount: number;
  textDirty: boolean;
  sensitive: boolean;
  score: number | null;
  sourceName: string;
  handle: string;
  scheduledAt: Date | null;
  error: string | null;
  assetIds: string[];
  slideCount: number;
};

type DraftRow = {
  id: string;
  topic_id: string;
  status: DraftStatus;
  format: "carousel_full" | "teaser_bio";
  template: "stabilo" | "foto_penuh" | "serif" | "catatan";
  slides: Slide[] | string;
  caption: string;
  hashtags: string[] | string;
  alt_headlines: [string, string] | string;
  focal_y: number;
  short_code: string;
  click_count: number;
  text_dirty: boolean;
  manual: boolean;
  scheduled_at: Date | null;
  error: string | null;
  score: number | null;
  sensitive: boolean;
  source_name: string;
  handle: string;
};

function parseSlides(raw: Slide[] | string): Slide[] {
  return typeof raw === "string" ? (JSON.parse(raw) as Slide[]) : raw;
}

function parseJsonArray<T>(raw: T[] | string): T[] {
  return typeof raw === "string" ? (JSON.parse(raw) as T[]) : raw;
}

function coverHeadline(slides: Slide[]): string {
  const cover = slides.find((s) => s.role === "cover") ?? slides[0];
  return cover?.headline ?? "";
}

function requireReviewWrite(role: Role): void {
  if (!can(role, "review.write")) {
    throw new Error("forbidden");
  }
}

function requirePublish(role: Role): void {
  if (!can(role, "publish")) {
    throw new Error("forbidden");
  }
}

function blockIfDirty(textDirty: boolean): void {
  if (textDirty) {
    throw new Error("Render dulu teks yang baru");
  }
}

async function loadDraftRow(sql: Sql, id: string): Promise<DraftRow> {
  const rows = await sql.rows<DraftRow>(
    `select d.id, d.topic_id, d.status, d.format, d.template, d.slides, d.caption, d.hashtags,
            d.alt_headlines, d.focal_y, d.short_code, d.click_count, d.text_dirty, d.manual,
            d.scheduled_at, d.error,
            t.score, t.sensitive, s.name as source_name, b.handle
     from drafts d
     join topics t on t.id = d.topic_id
     join sources s on s.id = t.source_id
     cross join brand b
     where d.id = $1 and b.id = 1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("draft tidak ditemukan");
  }
  return row;
}

function statusesForReviewTab(status: DraftStatus): DraftStatus[] {
  if (status === "scheduled") {
    return ["scheduled", "posting"];
  }
  return [status];
}

export async function listDrafts(sql: Sql, status: DraftStatus): Promise<DraftCard[]> {
  const statuses = statusesForReviewTab(status);
  const rows = await sql.rows<
    DraftRow & { updated_at: Date; asset_id: string | null }
  >(
    `select d.id, d.status, d.format, d.template, d.slides, d.short_code, d.click_count,
            d.updated_at, d.manual, t.score, t.sensitive, s.name as source_name, b.handle,
            (select a.id from assets a where a.draft_id = d.id order by a.slide_index limit 1) as asset_id
     from drafts d
     join topics t on t.id = d.topic_id
     join sources s on s.id = t.source_id
     cross join brand b
     where d.status = any($1::text[]) and b.id = 1
     order by d.updated_at desc`,
    [statuses],
  );
  return rows.map((row) => {
    const slides = parseSlides(row.slides);
    let slideCount = 2;
    try {
      slideCount = slidesForFormat(row.format, slides).length;
    } catch {
      slideCount = Math.max(slides.length, 1);
    }
    return {
      id: row.id,
      status: row.status,
      format: row.format,
      template: row.template,
      score: row.score,
      sensitive: row.sensitive,
      headline: coverHeadline(slides),
      sourceName: row.source_name,
      shortCode: row.short_code,
      clickCount: row.click_count,
      updatedAt: row.updated_at,
      manual: row.manual,
      assetId: row.asset_id,
      slideCount,
      handle: row.handle,
    };
  });
}

export async function countDraftsByStatus(sql: Sql): Promise<Partial<Record<DraftStatus, number>>> {
  const rows = await sql.rows<{ status: DraftStatus; count: number }>(
    `select status, count(*)::int as count from drafts group by status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

export async function getDraft(sql: Sql, id: string): Promise<DraftDetail | null> {
  const rows = await sql.rows<DraftRow>(
    `select d.id, d.topic_id, d.status, d.format, d.template, d.slides, d.caption, d.hashtags,
            d.alt_headlines, d.focal_y, d.short_code, d.click_count, d.text_dirty, d.manual,
            d.scheduled_at, d.error, t.score, t.sensitive, s.name as source_name, b.handle
     from drafts d
     join topics t on t.id = d.topic_id
     join sources s on s.id = t.source_id
     cross join brand b
     where d.id = $1 and b.id = 1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  const slides = parseSlides(row.slides);
  const assetRows = await sql.rows<{ id: string }>(
    `select id from assets where draft_id = $1 order by slide_index`,
    [id],
  );
  let slideCount = 2;
  try {
    slideCount = slidesForFormat(row.format, slides).length;
  } catch {
    slideCount = Math.max(slides.length, 1);
  }
  return {
    id: row.id,
    topicId: row.topic_id,
    status: row.status,
    format: row.format,
    template: row.template,
    slides,
    caption: row.caption,
    hashtags: parseJsonArray<string>(row.hashtags),
    altHeadlines: parseJsonArray<string>(row.alt_headlines) as [string, string],
    focalY: row.focal_y,
    shortCode: row.short_code,
    clickCount: row.click_count,
    textDirty: row.text_dirty,
    sensitive: row.sensitive,
    score: row.score,
    sourceName: row.source_name,
    handle: row.handle,
    scheduledAt: row.scheduled_at,
    error: row.error,
    assetIds: assetRows.map((a) => a.id),
    slideCount,
  };
}

export async function saveDraftText(
  sql: Sql,
  role: Role,
  id: string,
  input: {
    slides: Slide[];
    caption: string;
    hashtags: string[];
    altHeadlines: [string, string];
    kicker: string;
  },
): Promise<void> {
  requireReviewWrite(role);
  await loadDraftRow(sql, id);
  const slides = input.slides.map((slide) =>
    slide.role === "cover" ? { ...slide, kicker: input.kicker } : slide,
  );
  await sql.rows(
    `update drafts set slides = $1::jsonb, caption = $2, hashtags = $3::jsonb, alt_headlines = $4::jsonb,
     text_dirty = true, updated_at = now() where id = $5`,
    [
      JSON.stringify(slides),
      input.caption,
      JSON.stringify(input.hashtags),
      JSON.stringify(input.altHeadlines),
      id,
    ],
  );
}

export async function saveCoverPhoto(
  sql: Sql,
  role: Role,
  id: string,
  photoDataUrl: string,
): Promise<void> {
  requireReviewWrite(role);
  const row = await loadDraftRow(sql, id);
  const safeUrl = validateCoverPhotoDataUrl(photoDataUrl);
  const slides = parseSlides(row.slides);
  const updated = slides.map((slide) =>
    slide.role === "cover" ? ({ ...slide, photoDataUrl: safeUrl } as Slide & { photoDataUrl?: string }) : slide,
  );
  await sql.rows(
    `update drafts set slides = $1::jsonb, text_dirty = true, updated_at = now() where id = $2`,
    [JSON.stringify(updated), id],
  );
}

export async function saveFocal(sql: Sql, role: Role, id: string, focalY: number): Promise<void> {
  requireReviewWrite(role);
  await loadDraftRow(sql, id);
  const clamped = Math.min(100, Math.max(0, Math.round(focalY)));
  await sql.rows(`update drafts set focal_y = $1, text_dirty = true, updated_at = now() where id = $2`, [
    clamped,
    id,
  ]);
}

export async function setFormat(
  sql: Sql,
  role: Role,
  id: string,
  format: "carousel_full" | "teaser_bio",
): Promise<void> {
  requireReviewWrite(role);
  await loadDraftRow(sql, id);
  await sql.rows(`update drafts set format = $1, text_dirty = true, updated_at = now() where id = $2`, [
    format,
    id,
  ]);
}

export async function setTemplate(
  sql: Sql,
  role: Role,
  id: string,
  template: "stabilo" | "foto_penuh" | "serif" | "catatan",
): Promise<void> {
  requireReviewWrite(role);
  await loadDraftRow(sql, id);
  await sql.rows(`update drafts set template = $1, text_dirty = true, updated_at = now() where id = $2`, [
    template,
    id,
  ]);
}

export async function approveDraft(sql: Sql, role: Role, id: string): Promise<void> {
  requirePublish(role);
  const row = await loadDraftRow(sql, id);
  blockIfDirty(row.text_dirty);
  assertTransition("human", row.status, "approved");
  await sql.rows(`update drafts set status = 'approved', updated_at = now() where id = $1`, [id]);
}

export async function scheduleDraftInTx(
  tx: Sql,
  role: Role,
  id: string,
  scheduledAt: Date,
): Promise<void> {
  requirePublish(role);
  const row = await loadDraftRow(tx, id);
  blockIfDirty(row.text_dirty);
  if (scheduledAt.getTime() <= Date.now()) {
    throw new Error("Jadwal harus di masa depan");
  }
  assertTransition("human", row.status, "scheduled");
  await tx.rows(
    `update drafts set status = 'scheduled', scheduled_at = $1, updated_at = now() where id = $2`,
    [scheduledAt, id],
  );
  await enqueue(tx, {
    name: "publisher.publish",
    payload: { draftId: id },
    runAt: scheduledAt,
  });
}

export async function scheduleDraft(
  sql: Sql,
  role: Role,
  id: string,
  scheduledAt: Date,
): Promise<void> {
  await sql.tx(async (tx) => {
    await scheduleDraftInTx(tx, role, id, scheduledAt);
  });
}

async function postDraftNowInTx(tx: Sql, role: Role, id: string, row: DraftRow, now: Date): Promise<void> {
  if (row.status === "needs_review") {
    await tx.rows(`update drafts set status = 'approved', updated_at = $1 where id = $2`, [now, id]);
  }
  await tx.rows(`update drafts set status = 'posting', updated_at = $1 where id = $2`, [now, id]);
  await enqueue(tx, {
    name: "publisher.publish",
    payload: { draftId: id },
    runAt: now,
    manual: true,
  });
}

export async function postDraftNow(sql: Sql, role: Role, id: string): Promise<void> {
  requirePublish(role);
  const row = await loadDraftRow(sql, id);
  blockIfDirty(row.text_dirty);
  const now = new Date();
  if (row.status === "needs_review") {
    assertTransition("human", "needs_review", "approved");
  }
  const current = row.status === "needs_review" ? "approved" : row.status;
  assertTransition("human", current as DraftStatus, "posting");
  await sql.tx(async (tx) => {
    await postDraftNowInTx(tx, role, id, row, now);
  });
}

export async function markPostedManually(sql: Sql, role: Role, id: string): Promise<void> {
  requirePublish(role);
  const row = await loadDraftRow(sql, id);
  assertTransition("human", row.status, "posted", true);
  const now = new Date();
  await sql.rows(
    `update drafts set status = 'posted', manual = true, posted_at = $1, updated_at = $1 where id = $2`,
    [now, id],
  );
}

export async function rejectDraft(sql: Sql, role: Role, id: string): Promise<void> {
  requireReviewWrite(role);
  const row = await loadDraftRow(sql, id);
  assertTransition("human", row.status, "rejected");
  await sql.rows(`update drafts set status = 'rejected', updated_at = now() where id = $1`, [id]);
}

export async function deleteDraft(sql: Sql, role: Role, id: string): Promise<void> {
  requireReviewWrite(role);
  const row = await loadDraftRow(sql, id);
  if (row.status === "posting") {
    throw new Error("Tidak bisa hapus saat posting");
  }
  await sql.tx(async (tx) => {
    await tx.rows(`delete from drafts where id = $1`, [id]);
    await tx.rows(`update topics set state = 'passed' where id = $1`, [row.topic_id]);
  });
}

async function retryFailedInTx(tx: Sql, id: string, now: Date): Promise<void> {
  await tx.rows(
    `update drafts set status = 'posting', error = null, updated_at = $1 where id = $2`,
    [now, id],
  );
  await enqueue(tx, {
    name: "publisher.publish",
    payload: { draftId: id },
    runAt: now,
    manual: true,
  });
}

export async function retryFailed(sql: Sql, role: Role, id: string): Promise<void> {
  requirePublish(role);
  const row = await loadDraftRow(sql, id);
  blockIfDirty(row.text_dirty);
  assertTransition("human", row.status, "posting");
  const now = new Date();
  await sql.tx(async (tx) => {
    await retryFailedInTx(tx, id, now);
  });
}
