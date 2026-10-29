import { randomBytes, randomUUID } from "node:crypto";
import { parseCopy, type Slide } from "../agents/copywriter";
import { analystSystem, copySystem } from "../agents/prompts";
import { scoreTopic } from "../agents/analyst";
import { makeShortCode } from "../domain/code";
import {
  GRAPH_BASE,
  GRAPH_VERSION,
  INSIGHTS_INTERVAL_MS,
  PASS_THRESHOLD_DEFAULT,
  SCOUT_INTERVAL_MS,
  TIME_ZONE,
} from "../domain/constants";
import { assertTransition, type DraftStatus } from "../domain/status";
import { totalScore, verdict } from "../domain/score";
import { FakePublisher, MetaPublisher, type Publisher, type PublishResult } from "../publish/publisher";
import { renderSlideHtml, safePhotoDataUrl, slidesForFormat, type SlideTemplate } from "../render/html";
import { PlaywrightRasterizer, type Rasterizer } from "../render/raster";
import { createLlm, type LlmProvider } from "../llm/provider";
import { fetchPublicText, PRIVATE_FETCH_MESSAGE } from "../rss/fetch-guard";
import { excerptFromHtml } from "../rss/excerpt";
import { parseFeed } from "../rss/parse";
import { normalizeInsights, type DailyPoint } from "../studio/analytics";
import { validateCoverPhotoDataUrl, withLockedDraftEdit } from "../studio/drafts";
import { enqueue, type JobCtx } from "./runner";

export type ScoutCtx = JobCtx & {
  fetchFeed: (url: string) => Promise<string>;
  fetchPage: (url: string) => Promise<string>;
};

async function hasQueuedScoutScan(sql: JobCtx["sql"]): Promise<boolean> {
  const rows = await sql.rows<{ id: string }>(
    `select id from jobs
     where name = 'scout.scan' and finished_at is null and locked_at is null
     limit 1`,
  );
  return rows.length > 0;
}

export async function runScout(ctx: ScoutCtx): Promise<void> {
  const sources = await ctx.sql.rows<{ id: string; url: string }>(
    `select id, url from sources where enabled = true order by name`,
  );

  let newTopicCount = 0;

  for (const source of sources) {
    try {
      const xml = await ctx.fetchFeed(source.url);
      const items = parseFeed(xml);

      for (const item of items) {
        const known = await ctx.sql.rows<{ id: string }>(
          `select id from topics where url = $1 limit 1`,
          [item.url],
        );
        if (known.length > 0) {
          continue;
        }

        let excerpt = "";
        try {
          const html = await ctx.fetchPage(item.url);
          excerpt = excerptFromHtml(html);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === PRIVATE_FETCH_MESSAGE) {
            continue;
          }
          excerpt = "";
        }

        await ctx.sql.tx(async (tx) => {
          const inserted = await tx.rows<{ id: string }>(
            `insert into topics (id, source_id, title, url, summary, excerpt, published_at)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (url) do nothing
             returning id`,
            [
              randomUUID(),
              source.id,
              item.title,
              item.url,
              item.summary,
              excerpt,
              item.publishedAt,
            ],
          );
          if (inserted[0]) {
            newTopicCount += 1;
            await enqueue(tx, {
              name: "analyst.score",
              payload: { topicId: inserted[0].id },
              runAt: ctx.now,
              manual: ctx.manual,
            });
          }
        });
      }

      await ctx.sql.rows(
        `update sources set last_error = null, last_fetched_at = $1 where id = $2`,
        [ctx.now, source.id],
      );
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      await ctx.sql.rows(`update sources set last_error = $1 where id = $2`, [message, source.id]);
    }
  }

  const activityMessage =
    newTopicCount > 0 ? `Menemukan ${newTopicCount} topik baru` : "Belum ada topik baru";
  await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
    randomUUID(),
    "scout",
    activityMessage,
  ]);

  if (!(await hasQueuedScoutScan(ctx.sql))) {
    await enqueue(ctx.sql, {
      name: "scout.scan",
      payload: {},
      runAt: new Date(ctx.now.getTime() + SCOUT_INTERVAL_MS),
      manual: false,
    });
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  return fetchPublicText(url, timeoutMs);
}

async function runScoutCron(ctx: JobCtx): Promise<void> {
  const timeoutMs = 8000;
  return runScout({
    ...ctx,
    fetchFeed: (url) => fetchWithTimeout(url, timeoutMs),
    fetchPage: (url) => fetchWithTimeout(url, timeoutMs),
  });
}

export type AnalystCtx = JobCtx & { llm?: LlmProvider };

async function loadPassThreshold(sql: JobCtx["sql"]): Promise<number> {
  const rows = await sql.rows<{ pass_threshold: number }>(
    "select pass_threshold from brand where id = 1",
  );
  return rows[0]?.pass_threshold ?? PASS_THRESHOLD_DEFAULT;
}

async function loadBrain(sql: JobCtx["sql"]): Promise<string> {
  const docs = await sql.rows<{ title: string; body: string }>(
    "select title, body from brain_docs order by slug",
  );
  return docs.map((d) => `## ${d.title}\n${d.body}`).join("\n\n");
}

function formatPublished(at: Date | null | undefined): string {
  if (!at) {
    return "tidak diketahui";
  }
  return at.toISOString();
}

async function scoreOneTopic(
  ctx: AnalystCtx,
  llm: LlmProvider,
  topicId: string,
): Promise<{ passed: boolean; valid: boolean }> {
  const topics = await ctx.sql.rows<{
    id: string;
    title: string;
    url: string;
    summary: string;
    excerpt: string;
    published_at: Date | null;
    state: string;
    source_name: string;
  }>(
    `select t.id, t.title, t.url, t.summary, t.excerpt, t.published_at, t.state, s.name as source_name
     from topics t
     join sources s on s.id = t.source_id
     where t.id = $1`,
    [topicId],
  );
  const topic = topics[0];
  if (!topic || topic.state !== "new") {
    return { passed: false, valid: false };
  }

  const brain = await loadBrain(ctx.sql);
  const user = [
    `Judul: ${topic.title}`,
    `URL: ${topic.url}`,
    `Sumber: ${topic.source_name}`,
    `Diterbitkan: ${formatPublished(topic.published_at)}`,
    `Ringkasan: ${topic.summary}`,
    `Cuplikan: ${topic.excerpt}`,
  ].join("\n");

  const result = await llm.complete({
    purpose: "score",
    system: analystSystem(brain),
    user,
  });

  await ctx.sql.rows(
    `insert into llm_spend (id, agent, model, cost_usd) values ($1, $2, $3, $4)`,
    [randomUUID(), "analis", result.model, result.costUsd],
  );

  let scored;
  try {
    scored = scoreTopic(result.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "skor tidak valid";
    const failed = await ctx.sql.rows<{ id: string }>(
      `update topics set state = 'failed', error = $1 where id = $2 and state = 'new' returning id`,
      [message, topicId],
    );
    if (failed.length === 0) {
      return { passed: false, valid: false };
    }
    await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
      randomUUID(),
      "analis",
      `Gagal menilai "${topic.title}"`,
    ]);
    return { passed: false, valid: false };
  }

  const threshold = await loadPassThreshold(ctx.sql);
  const score = totalScore(scored.aspects);
  const blocked = scored.blocked;
  const passed = !blocked && verdict(score, threshold) === "lolos";
  const state = blocked || verdict(score, threshold) === "dilewati" ? "skipped" : "passed";

  const applied = await ctx.sql.tx(async (tx) => {
    const updated = await tx.rows<{ id: string }>(
      `update topics set
         state = $1,
         score = $2,
         aspects = $3::jsonb,
         tags = $4::jsonb,
         sensitive = $5,
         sensitive_reason = $6,
         blocked = $7,
         score_reason = $8,
         scored_at = $9,
         error = null
       where id = $10 and state = 'new'
       returning id`,
      [
        state,
        score,
        JSON.stringify(scored.aspects),
        JSON.stringify(scored.tags),
        scored.sensitive,
        scored.sensitiveReason,
        blocked,
        scored.reason,
        ctx.now,
        topicId,
      ],
    );
    if (updated.length === 0) {
      return false;
    }
    if (passed) {
      const pending = await tx.rows<{ id: string }>(
        `select id from jobs
         where name = 'copywriter.write'
           and finished_at is null
           and payload->>'topicId' = $1
         limit 1`,
        [topicId],
      );
      if (pending.length === 0) {
        await enqueue(tx, {
          name: "copywriter.write",
          payload: { topicId },
          runAt: ctx.now,
          manual: false,
        });
      }
    }
    return true;
  });

  if (!applied) {
    return { passed: false, valid: false };
  }
  return { passed, valid: true };
}

export async function runAnalyst(ctx: AnalystCtx): Promise<void> {
  const llm = ctx.llm ?? createLlm();
  const threshold = await loadPassThreshold(ctx.sql);

  if (ctx.payload.rescoreWaiting === true) {
    const waiting = await ctx.sql.rows<{ id: string }>(
      `select id from topics where state = 'new' order by discovered_at asc limit 20`,
    );
    let validCount = 0;
    let passedCount = 0;
    for (const row of waiting) {
      const outcome = await scoreOneTopic(ctx, llm, row.id);
      if (outcome.valid) {
        validCount += 1;
        if (outcome.passed) {
          passedCount += 1;
        }
      }
    }
    if (validCount > 0) {
      await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
        randomUUID(),
        "analis",
        `Menilai ${validCount} topik, ${passedCount} lolos ambang skor ${threshold}`,
      ]);
    }
    return;
  }

  const topicId = ctx.payload.topicId;
  if (typeof topicId !== "string" || !topicId) {
    return;
  }

  const outcome = await scoreOneTopic(ctx, llm, topicId);
  if (outcome.valid) {
    await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
      randomUUID(),
      "analis",
      `Menilai 1 topik, ${outcome.passed ? 1 : 0} lolos ambang skor ${threshold}`,
    ]);
  }
}

export type CopywriterCtx = JobCtx & { llm?: LlmProvider };

function isUniqueViolation(error: unknown): boolean {
  if (error && typeof error === "object") {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/unique/i.test(message)) {
      return true;
    }
  }
  return false;
}

async function loadBrandDefaults(sql: JobCtx["sql"]): Promise<{ format: string; template: string }> {
  const rows = await sql.rows<{ default_format: string; default_template: string }>(
    "select default_format, default_template from brand where id = 1",
  );
  return {
    format: rows[0]?.default_format ?? "teaser_bio",
    template: rows[0]?.default_template ?? "serif",
  };
}

function slidesKeepingCoverPhoto(nextSlides: Slide[], stored: unknown): Slide[] {
  const parsed = (typeof stored === "string" ? JSON.parse(stored) : stored) as (Slide & {
    photoDataUrl?: string;
  })[];
  if (!Array.isArray(parsed)) {
    return nextSlides;
  }
  const cover = parsed.find((slide) => slide.role === "cover") ?? parsed[0];
  const raw = cover?.photoDataUrl;
  if (typeof raw !== "string" || raw.length === 0) {
    return nextSlides;
  }
  try {
    const photo = validateCoverPhotoDataUrl(raw);
    return nextSlides.map((slide) => (slide.role === "cover" ? { ...slide, photoDataUrl: photo } : slide));
  } catch {
    return nextSlides;
  }
}

async function topicDraftIsPosting(sql: JobCtx["sql"], topicId: string): Promise<boolean> {
  const rows = await sql.rows<{ id: string }>(
    `select id from drafts where topic_id = $1 and status = 'posting' limit 1`,
    [topicId],
  );
  return rows.length > 0;
}

export async function runCopywriter(ctx: CopywriterCtx): Promise<void> {
  const llm = ctx.llm ?? createLlm();
  const topicId = ctx.payload.topicId;
  if (typeof topicId !== "string" || !topicId) {
    return;
  }

  const topics = await ctx.sql.rows<{
    id: string;
    title: string;
    url: string;
    summary: string;
    excerpt: string;
    published_at: Date | null;
    state: string;
    source_name: string;
  }>(
    `select t.id, t.title, t.url, t.summary, t.excerpt, t.published_at, t.state, s.name as source_name
     from topics t
     join sources s on s.id = t.source_id
     where t.id = $1`,
    [topicId],
  );
  const topic = topics[0];
  if (!topic) {
    throw new Error("topik tidak ditemukan");
  }

  const force = ctx.payload.force === true;
  if ((topic.state === "skipped" || topic.state === "failed") && !force) {
    return;
  }

  const rewrite = ctx.payload.rewrite === true;
  if (rewrite && (await topicDraftIsPosting(ctx.sql, topicId))) {
    return;
  }
  if (!rewrite) {
    const already = await ctx.sql.rows<{ id: string }>(
      "select id from drafts where topic_id = $1 limit 1",
      [topicId],
    );
    if (already[0]) {
      return;
    }
  }

  const brain = await loadBrain(ctx.sql);
  const user = [
    `Judul: ${topic.title}`,
    `URL: ${topic.url}`,
    `Sumber: ${topic.source_name}`,
    `Diterbitkan: ${formatPublished(topic.published_at)}`,
    `Ringkasan: ${topic.summary}`,
    `Cuplikan: ${topic.excerpt}`,
  ].join("\n");

  const result = await llm.complete({
    purpose: "copy",
    system: copySystem(brain),
    user,
  });

  await ctx.sql.rows(
    `insert into llm_spend (id, agent, model, cost_usd) values ($1, $2, $3, $4)`,
    [randomUUID(), "copywriter", result.model, result.costUsd],
  );

  let copy: ReturnType<typeof parseCopy>;
  try {
    copy = parseCopy(result.text, topic.source_name);
  } catch (error) {
    if (rewrite && (await topicDraftIsPosting(ctx.sql, topicId))) {
      return;
    }
    const message = error instanceof Error ? error.message : "naskah tidak valid";
    await ctx.sql.rows(`update topics set state = 'failed', error = $1 where id = $2`, [message, topicId]);
    await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
      randomUUID(),
      "copywriter",
      `Gagal menulis "${topic.title}"`,
    ]);
    return;
  }

  const existingDrafts = await ctx.sql.rows<{ id: string }>(
    "select id from drafts where topic_id = $1 limit 1",
    [topicId],
  );
  const existingDraft = existingDrafts[0];

  if (rewrite && existingDraft) {
    const applied = await ctx.sql.tx(async (tx) => {
      return withLockedDraftEdit(tx, existingDraft.id, "rewrite", async (locked, nextStatus) => {
        const slides = slidesKeepingCoverPhoto(copy.slides, locked.slides);
        return tx.rows<{ id: string }>(
          `update drafts set
             slides = $1::jsonb,
             caption = $2,
             hashtags = $3::jsonb,
             alt_headlines = $4::jsonb,
             text_dirty = true,
             status = $5,
             updated_at = $6
           where id = $7 and status = $8
           returning id`,
          [
            JSON.stringify(slides),
            copy.caption,
            JSON.stringify(copy.hashtags),
            JSON.stringify(copy.altHeadlines),
            nextStatus,
            ctx.now,
            existingDraft.id,
            locked.status,
          ],
        );
      });
    });
    if (!applied) {
      return;
    }
    await ctx.sql.rows(`update topics set state = 'drafted', error = null where id = $1`, [topicId]);
    const coverHeadline = copy.slides[0]?.headline ?? topic.title;
    await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
      randomUUID(),
      "copywriter",
      `Draft siap: "${coverHeadline}"`,
    ]);
    await enqueue(ctx.sql, {
      name: "designer.render",
      payload: { draftId: existingDraft.id },
      runAt: ctx.now,
      manual: ctx.manual,
    });
    return;
  }

  const brand = await loadBrandDefaults(ctx.sql);
  const slidesJson = JSON.stringify(copy.slides);
  let draftId: string | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomUUID();
    const shortCode = makeShortCode(randomBytes(5));
    try {
      const inserted = await ctx.sql.tx(async (tx) => {
        await tx.rows(`select id from topics where id = $1 for update`, [topicId]);
        const existing = await tx.rows<{ id: string }>(
          "select id from drafts where topic_id = $1 limit 1",
          [topicId],
        );
        if (existing[0]) {
          return null;
        }
        await tx.rows(
          `insert into drafts (
             id, topic_id, status, format, template, slides, caption, hashtags, alt_headlines, focal_y, short_code, manual
           ) values ($1, $2, 'drafted', $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, 50, $9, $10)`,
          [
            id,
            topicId,
            brand.format,
            brand.template,
            slidesJson,
            copy.caption,
            JSON.stringify(copy.hashtags),
            JSON.stringify(copy.altHeadlines),
            shortCode,
            ctx.manual,
          ],
        );
        await tx.rows(`update topics set state = 'drafted', error = null where id = $1`, [topicId]);
        await enqueue(tx, {
          name: "designer.render",
          payload: { draftId: id },
          runAt: ctx.now,
          manual: ctx.manual,
        });
        return id;
      });
      if (inserted === null) {
        return;
      }
      draftId = inserted;
      break;
    } catch (error) {
      if (isUniqueViolation(error) && attempt < 4) {
        continue;
      }
      throw error;
    }
  }

  if (!draftId) {
    throw new Error("gagal membuat short_code unik");
  }
  const coverHeadline = copy.slides[0]?.headline ?? topic.title;
  await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
    randomUUID(),
    "copywriter",
    `Draft siap: "${coverHeadline}"`,
  ]);
}

export type DesignerCtx = JobCtx & { rasterizer?: Rasterizer };

type SlideWithPhoto = Slide & { photoDataUrl?: string };

function photoInputForSlide(
  slide: Slide,
  draftFocalY: number,
): { photoDataUrl: string | null; focalY: number } {
  if (slide.role !== "cover") {
    return { photoDataUrl: null, focalY: draftFocalY };
  }
  const raw = (slide as SlideWithPhoto).photoDataUrl;
  const photoDataUrl = safePhotoDataUrl(typeof raw === "string" ? raw : null);
  return { photoDataUrl, focalY: draftFocalY };
}

class SupersededRenderError extends Error {
  constructor() {
    super("superseded render");
    this.name = "SupersededRenderError";
  }
}

export async function runDesigner(ctx: DesignerCtx): Promise<void> {
  const draftId = ctx.payload.draftId;
  if (typeof draftId !== "string" || !draftId) {
    throw new Error("draft tidak ditemukan");
  }

  const rows = await ctx.sql.rows<{
    status: string;
    format: string;
    template: string;
    slides: Slide[] | string;
    focal_y: number;
    source_name: string;
    handle: string;
    accent: string;
    updated_at: Date;
  }>(
    `select d.status, d.format, d.template, d.slides, d.focal_y, d.updated_at,
            s.name as source_name, b.handle, b.accent
     from drafts d
     join topics t on t.id = d.topic_id
     join sources s on s.id = t.source_id
     cross join brand b
     where d.id = $1 and b.id = 1`,
    [draftId],
  );
  const draft = rows[0];
  if (!draft) {
    throw new Error("draft tidak ditemukan");
  }
  if (draft.status === "posting") {
    return;
  }

  const ownedRasterizer = ctx.rasterizer === undefined;
  const rasterizer = ctx.rasterizer ?? new PlaywrightRasterizer();

  const allSlides: Slide[] =
    typeof draft.slides === "string" ? (JSON.parse(draft.slides) as Slide[]) : draft.slides;
  const format = draft.format as "carousel_full" | "teaser_bio";
  const selected = slidesForFormat(format, allSlides);
  const template = draft.template as SlideTemplate;
  const current = draft.status as DraftStatus;
  const startedAt = draft.updated_at;

  const rendered: Uint8Array[] = [];
  try {
    try {
      for (let index = 0; index < selected.length; index++) {
        const slide = selected[index];
        const { photoDataUrl, focalY } = photoInputForSlide(slide, draft.focal_y);
        const html = renderSlideHtml({
          template,
          slide,
          index,
          total: selected.length,
          handle: draft.handle,
          sourceName: draft.source_name,
          accent: draft.accent,
          focalY,
          photoDataUrl,
        });
        rendered.push(await rasterizer.toPng(html));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.sql.rows(`update drafts set error = $1 where id = $2 and updated_at = $3`, [
        message,
        draftId,
        startedAt,
      ]);
      throw error;
    }
  } finally {
    if (ownedRasterizer && rasterizer instanceof PlaywrightRasterizer) {
      await rasterizer.close();
    }
  }

  try {
    await ctx.sql.tx(async (tx) => {
      await tx.rows(`delete from assets where draft_id = $1`, [draftId]);
      for (let index = 0; index < rendered.length; index++) {
        await tx.rows(
          `insert into assets (id, draft_id, slide_index, bytes) values ($1, $2, $3, $4)`,
          [randomUUID(), draftId, index, rendered[index]],
        );
      }
      let updated: { id: string }[];
      if (current === "drafted") {
        assertTransition("worker", "drafted", "needs_review");
        updated = await tx.rows<{ id: string }>(
          `update drafts
           set status = 'needs_review', text_dirty = false, error = null, updated_at = $1
           where id = $2 and status = 'drafted' and updated_at = $3
           returning id`,
          [ctx.now, draftId, startedAt],
        );
      } else {
        updated = await tx.rows<{ id: string }>(
          `update drafts
           set text_dirty = false, error = null, updated_at = $1
           where id = $2 and status = $3 and updated_at = $4
           returning id`,
          [ctx.now, draftId, current, startedAt],
        );
      }
      if (updated.length === 0) {
        throw new SupersededRenderError();
      }
    });
  } catch (error) {
    if (error instanceof SupersededRenderError) {
      if (current === "drafted") {
        throw new Error("first render did not enter the review queue");
      }
      return;
    }
    throw error;
  }

  const coverHeadline = selected[0]?.headline ?? "draft";
  await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
    randomUUID(),
    "designer",
    `Gambar selesai untuk "${coverHeadline}"`,
  ]);
}


const PUBLIC_BASE_FALLBACK = "http://127.0.0.1:43123";

function asStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string");
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asSlides(raw: unknown): Slide[] {
  if (Array.isArray(raw)) {
    return raw as Slide[];
  }
  if (typeof raw === "string") {
    return JSON.parse(raw) as Slide[];
  }
  return [];
}

export async function runPublisher(ctx: JobCtx & { publisher?: Publisher }): Promise<void> {
  const draftId = ctx.payload.draftId;
  if (typeof draftId !== "string" || !draftId) {
    throw new Error("draft tidak ditemukan");
  }

  const rows = await ctx.sql.rows<{
    status: DraftStatus;
    caption: string;
    hashtags: unknown;
    slides: unknown;
    format: "carousel_full" | "teaser_bio";
    share_to_story: boolean;
    topic_url: string;
    source_name: string;
    public_base_url: string | null;
    ig_user_id: string | null;
    access_token: string | null;
    ig_media_id: string | null;
    story_media_id: string | null;
    story_error: string | null;
  }>(
    `select d.status, d.caption, d.hashtags, d.slides, d.format, d.share_to_story,
            t.url as topic_url, s.name as source_name,
            b.public_base_url,
            i.ig_user_id, i.access_token,
            d.ig_media_id, d.story_media_id, d.story_error
     from drafts d
     join topics t on t.id = d.topic_id
     join sources s on s.id = t.source_id
     left join brand b on b.id = 1
     left join ig_connection i on i.id = 1
     where d.id = $1`,
    [draftId],
  );
  const draft = rows[0];
  if (!draft) {
    throw new Error("draft tidak ditemukan");
  }

  if (draft.status === "posted" || draft.status === "failed") {
    return;
  }
  if (draft.status === "scheduled") {
    assertTransition("worker", "scheduled", "posting");
    const updated = await ctx.sql.rows<{ id: string }>(
      `update drafts set status = 'posting', updated_at = $2
       where id = $1 and status = 'scheduled'
       returning id`,
      [draftId, ctx.now],
    );
    if (updated.length === 0) {
      throw new Error("publish requires human approval");
    }
  } else if (draft.status !== "posting") {
    throw new Error("publish requires human approval");
  }

  if (draft.ig_media_id != null) {
    await finishPostingDraft(ctx, draftId, {
      mediaId: draft.ig_media_id,
      storyMediaId: draft.story_media_id,
      storyError: draft.story_error,
    });
    return;
  }

  if (
    draft.status === "posting" &&
    draft.ig_media_id == null &&
    (ctx.reclaimed === true || (ctx.attempts ?? 0) > 0)
  ) {
    assertTransition("worker", "posting", "failed");
    await ctx.sql.rows(
      `update drafts set status = 'failed', error = $1, updated_at = $2
       where id = $3 and status = 'posting'`,
      ["Posting terputus sebelum id Instagram tersimpan", ctx.now, draftId],
    );
    return;
  }

  if (process.env.META_PROVIDER === "meta" && draft.access_token == null) {
    assertTransition("worker", "posting", "failed");
    await ctx.sql.rows(
      `update drafts set status = 'failed', error = $1, updated_at = $2
       where id = $3 and status = 'posting'`,
      ["Instagram belum terhubung", ctx.now, draftId],
    );
    return;
  }

  const publisher =
    ctx.publisher ??
    (process.env.META_PROVIDER === "meta" ? new MetaPublisher(fetch) : new FakePublisher());

  let result: PublishResult;
  try {
    if (!draft.topic_url || !draft.source_name) {
      throw new Error("draft tidak ditemukan");
    }
    const assets = await ctx.sql.rows<{ id: string; slide_index: number }>(
      `select id, slide_index from assets where draft_id = $1 order by slide_index`,
      [draftId],
    );
    const publicBaseUrl = (draft.public_base_url || PUBLIC_BASE_FALLBACK).replace(/\/$/, "");
    const imageUrls = assets.map((asset) => `${publicBaseUrl}/media/${asset.id}`);
    const selected = slidesForFormat(draft.format, asSlides(draft.slides));
    const altTexts = assets.map((asset) => selected[asset.slide_index]?.headline ?? "");
    const hashtags = asStringArray(draft.hashtags);
    const caption = `${draft.caption}\n\n${hashtags.map((tag) => `#${tag}`).join(" ")}`;
    result = await publisher.publish({
      igUserId: draft.ig_user_id ?? "",
      accessToken: draft.access_token ?? "",
      imageUrls,
      caption,
      altTexts,
      shareToStory: draft.share_to_story,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertTransition("worker", "posting", "failed");
    await ctx.sql.rows(
      `update drafts set status = 'failed', error = $1, updated_at = $2
       where id = $3 and status = 'posting'`,
      [message, ctx.now, draftId],
    );
    return;
  }

  const saved = await ctx.sql.rows<{ id: string }>(
    `update drafts
     set ig_media_id = $1, story_media_id = $2, story_error = $3, updated_at = $4
     where id = $5 and status = 'posting'
     returning id`,
    [result.mediaId, result.storyMediaId, result.storyError, ctx.now, draftId],
  );
  if (saved.length === 0) {
    throw new Error("Status draf sudah berubah");
  }
  await finishPostingDraft(ctx, draftId, {
    mediaId: result.mediaId,
    storyMediaId: result.storyMediaId,
    storyError: result.storyError,
  });
}

async function finishPostingDraft(
  ctx: JobCtx,
  draftId: string,
  result: PublishResult,
): Promise<void> {
  assertTransition("worker", "posting", "posted");
  const posted = await ctx.sql.rows<{ id: string }>(
    `update drafts
     set status = 'posted', ig_media_id = $1, story_media_id = $2, story_error = $3,
         posted_at = $4, updated_at = $4, error = null
     where id = $5 and status = 'posting'
     returning id`,
    [result.mediaId, result.storyMediaId, result.storyError, ctx.now, draftId],
  );
  if (posted.length === 0) {
    throw new Error("Status draf sudah berubah");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function graphUrl(path: string, accessToken: string, query?: Record<string, string>): string {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${path}`);
  url.searchParams.set("access_token", accessToken);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function graphGet(
  fetchImpl: typeof fetch,
  path: string,
  accessToken: string,
  query?: Record<string, string>,
): Promise<unknown> {
  const res = await fetchImpl(graphUrl(path, accessToken, query));
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok && !isRecord(body)) {
    throw new Error(`Instagram API ${res.status}`);
  }
  return body;
}

function hasGraphError(body: unknown): boolean {
  return isRecord(body) && isRecord(body.error);
}

function readFollowers(body: unknown): number {
  if (!isRecord(body) || isRecord(body.error)) return 0;
  return typeof body.followers_count === "number" && Number.isFinite(body.followers_count)
    ? body.followers_count
    : 0;
}

function metricNumber(data: unknown[], name: string): number {
  for (const item of data) {
    if (!isRecord(item) || item.name !== name || isRecord(item.error)) continue;
    if (!Array.isArray(item.values)) return 0;
    const last = item.values[item.values.length - 1];
    if (!isRecord(last) || typeof last.value !== "number" || !Number.isFinite(last.value)) return 0;
    return last.value;
  }
  return 0;
}

function jakartaDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function readDaily(
  body: unknown,
  followers: number,
  syncDate: string,
  priorFollowers: ReadonlyMap<string, number>,
): DailyPoint[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  const byDate = new Map<string, { views: number; reach: number }>();
  for (const metric of body.data) {
    if (!isRecord(metric) || isRecord(metric.error)) continue;
    if (metric.name !== "views" && metric.name !== "reach") continue;
    if (!Array.isArray(metric.values)) continue;
    for (const point of metric.values) {
      if (!isRecord(point) || typeof point.end_time !== "string") continue;
      if (typeof point.value !== "number" || !Number.isFinite(point.value)) continue;
      const at = new Date(point.end_time);
      if (Number.isNaN(at.getTime())) continue;
      // period=day end_time is the exclusive midnight that ends that day.
      const date = jakartaDate(new Date(at.getTime() - 1));
      const row = byDate.get(date) ?? { views: 0, reach: 0 };
      row[metric.name] += point.value;
      byDate.set(date, row);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      date,
      views: row.views,
      reach: row.reach,
      followers: date === syncDate ? followers : (priorFollowers.get(date) ?? null),
    }));
}

function storedFollowerPoints(raw: unknown): { date: string; followers: number }[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const points = [];
  for (const item of parsed) {
    if (!isRecord(item) || typeof item.date !== "string") continue;
    if (typeof item.followers !== "number" || !Number.isFinite(item.followers)) continue;
    points.push({ date: item.date, followers: item.followers });
  }
  return points;
}

async function measuredFollowers(sql: JobCtx["sql"]): Promise<Map<string, number>> {
  const rows = await sql.rows<{ daily: unknown }>(
    `select daily from insight_snapshots order by taken_at desc`,
  );
  const measured = new Map<string, number>();
  for (const row of rows) {
    for (const point of storedFollowerPoints(row.daily)) {
      if (!measured.has(point.date)) measured.set(point.date, point.followers);
    }
  }
  return measured;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readPosts(body: unknown): {
  igMediaId: string;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
}[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  const posts = [];
  for (const media of body.data) {
    if (!isRecord(media)) continue;
    const igMediaId =
      typeof media.id === "string" ? media.id : typeof media.id === "number" ? String(media.id) : "";
    if (!igMediaId) continue;
    const insights = isRecord(media.insights) && !isRecord(media.insights.error) ? media.insights : null;
    const insightData = insights && Array.isArray(insights.data) ? insights.data : [];
    posts.push({
      igMediaId,
      views: metricNumber(insightData, "views"),
      reach: metricNumber(insightData, "reach"),
      saves: metricNumber(insightData, "saved"),
      shares: metricNumber(insightData, "shares"),
      likes: readCount(media.like_count),
      comments: readCount(media.comments_count),
    });
  }
  return posts;
}

async function recordInsightsFailure(ctx: JobCtx): Promise<void> {
  await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
    randomUUID(),
    "analitik",
    "Analitik gagal diambil dari Instagram",
  ]);
  await enqueueNextInsights(ctx);
}

async function enqueueNextInsights(ctx: JobCtx): Promise<void> {
  // The runner sets finished_at only after this handler returns, so the in-flight
  // row is still open. Count unlocked rows only; otherwise the next interval is never
  // scheduled. A second unlocked insights.sync is not enqueued.
  const pending = await ctx.sql.rows<{ id: string }>(
    `select id from jobs
     where name = 'insights.sync' and finished_at is null and locked_at is null
     limit 1`,
  );
  if (pending.length > 0) return;
  await enqueue(ctx.sql, {
    name: "insights.sync",
    payload: {},
    runAt: new Date(ctx.now.getTime() + INSIGHTS_INTERVAL_MS),
    manual: false,
  });
}

export async function runInsights(ctx: JobCtx & { fetchImpl?: typeof fetch }): Promise<void> {
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const rows = await ctx.sql.rows<{ ig_user_id: string | null; access_token: string | null }>(
    `select ig_user_id, access_token from ig_connection where id = 1`,
  );
  const connection = rows[0];
  const token = connection?.access_token?.trim() ?? "";
  const igUserId = connection?.ig_user_id?.trim() ?? "";
  if (!token || !igUserId) {
    await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
      randomUUID(),
      "analitik",
      "Analitik dilewati: Instagram belum terhubung",
    ]);
    await enqueueNextInsights(ctx);
    return;
  }

  const since = Math.floor((ctx.now.getTime() - 90 * 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(ctx.now.getTime() / 1000);
  let followersBody: unknown;
  let insightsBody: unknown;
  let mediaBody: unknown;
  try {
    [followersBody, insightsBody, mediaBody] = await Promise.all([
      graphGet(fetchImpl, igUserId, token, { fields: "followers_count" }),
      graphGet(fetchImpl, `${igUserId}/insights`, token, {
        metric: "views,reach",
        period: "day",
        since: String(since),
        until: String(until),
      }),
      graphGet(fetchImpl, `${igUserId}/media`, token, {
        fields: "id,timestamp,like_count,comments_count,media_type,insights.metric(views,reach,saved,shares)",
        limit: "50",
      }),
    ]);
  } catch {
    await recordInsightsFailure(ctx);
    return;
  }

  // A metric error inside insights `data` is still a zero. A top-level error
  // on followers or account insights is a failed sync, not a snapshot of zeros.
  if (hasGraphError(followersBody) || hasGraphError(insightsBody)) {
    await recordInsightsFailure(ctx);
    return;
  }

  const followers = readFollowers(followersBody);
  const normalized = normalizeInsights({
    followers,
    daily: readDaily(insightsBody, followers, jakartaDate(ctx.now), await measuredFollowers(ctx.sql)),
    accountsEngaged: null,
    posts: readPosts(mediaBody),
  });

  await ctx.sql.tx(async (tx) => {
    await tx.rows(
      `insert into insight_snapshots (id, taken_at, followers, views, reach, interactions, accounts_engaged, daily)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(),
        ctx.now,
        normalized.snapshot.followers,
        normalized.snapshot.views,
        normalized.snapshot.reach,
        normalized.snapshot.interactions,
        normalized.snapshot.accountsEngaged,
        JSON.stringify(normalized.snapshot.daily),
      ],
    );
    for (const post of normalized.posts) {
      await tx.rows(
        `insert into post_insights (draft_id, views, reach, likes, comments, saves, shares, synced_at)
         select d.id, $2, $3, $4, $5, $6, $7, $8
         from drafts d
         where d.ig_media_id = $1
         on conflict (draft_id) do update set
           views = excluded.views,
           reach = excluded.reach,
           likes = excluded.likes,
           comments = excluded.comments,
           saves = excluded.saves,
           shares = excluded.shares,
           synced_at = excluded.synced_at`,
        [
          post.igMediaId,
          post.views,
          post.reach,
          post.likes,
          post.comments,
          post.saves,
          post.shares,
          ctx.now,
        ],
      );
    }
  });

  await enqueueNextInsights(ctx);
}

export const jobHandlers = {
  "scout.scan": runScoutCron,
  "analyst.score": runAnalyst,
  "copywriter.write": runCopywriter,
  "designer.render": runDesigner,
  "publisher.publish": runPublisher,
  "insights.sync": runInsights,
};
