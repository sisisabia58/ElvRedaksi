import { randomBytes, randomUUID } from "node:crypto";
import { parseCopy, type Slide } from "../agents/copywriter";
import { analystSystem, copySystem } from "../agents/prompts";
import { scoreTopic } from "../agents/analyst";
import { makeShortCode } from "../domain/code";
import { PASS_THRESHOLD_DEFAULT, SCOUT_INTERVAL_MS } from "../domain/constants";
import { assertTransition, type DraftStatus } from "../domain/status";
import { totalScore, verdict } from "../domain/score";
import { renderSlideHtml, safePhotoDataUrl, slidesForFormat, type SlideTemplate } from "../render/html";
import { PlaywrightRasterizer, type Rasterizer } from "../render/raster";
import { createLlm, type LlmProvider } from "../llm/provider";
import { fetchPublicText } from "../rss/fetch-guard";
import { excerptFromHtml } from "../rss/excerpt";
import { parseFeed } from "../rss/parse";
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
        } catch {
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
    source_name: string;
  }>(
    `select t.id, t.title, t.url, t.summary, t.excerpt, t.published_at, s.name as source_name
     from topics t
     join sources s on s.id = t.source_id
     where t.id = $1`,
    [topicId],
  );
  const topic = topics[0];
  if (!topic) {
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
    await ctx.sql.rows(
      `update topics set state = 'failed', error = $1 where id = $2`,
      [message, topicId],
    );
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

  await ctx.sql.rows(
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
     where id = $10`,
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

  if (passed) {
    await enqueue(ctx.sql, {
      name: "copywriter.write",
      payload: { topicId },
      runAt: ctx.now,
      manual: false,
    });
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
    const message = error instanceof Error ? error.message : "naskah tidak valid";
    await ctx.sql.rows(`update topics set state = 'failed', error = $1 where id = $2`, [message, topicId]);
    await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
      randomUUID(),
      "copywriter",
      `Gagal menulis "${topic.title}"`,
    ]);
    return;
  }

  const rewrite = ctx.payload.rewrite === true;
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
      await ctx.sql.rows(
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
      draftId = id;
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

  await ctx.sql.rows(`update topics set state = 'drafted', error = null where id = $1`, [topicId]);
  const coverHeadline = copy.slides[0]?.headline ?? topic.title;
  await ctx.sql.rows(`insert into activity (id, agent, message) values ($1, $2, $3)`, [
    randomUUID(),
    "copywriter",
    `Draft siap: "${coverHeadline}"`,
  ]);
  await enqueue(ctx.sql, {
    name: "designer.render",
    payload: { draftId },
    runAt: ctx.now,
    manual: ctx.manual,
  });
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


export async function runPublisher(_ctx: JobCtx): Promise<void> {}

export async function runInsights(_ctx: JobCtx): Promise<void> {}

export const jobHandlers = {
  "scout.scan": runScoutCron,
  "analyst.score": runAnalyst,
  "copywriter.write": runCopywriter,
  "designer.render": runDesigner,
  "publisher.publish": runPublisher,
  "insights.sync": runInsights,
};
