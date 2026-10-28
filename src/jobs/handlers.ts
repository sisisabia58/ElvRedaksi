import { randomUUID } from "node:crypto";
import { analystSystem } from "../agents/prompts";
import { scoreTopic } from "../agents/analyst";
import { PASS_THRESHOLD_DEFAULT, SCOUT_INTERVAL_MS } from "../domain/constants";
import { totalScore, verdict } from "../domain/score";
import { createLlm, type LlmProvider } from "../llm/provider";
import { fetchPublicText } from "../rss/fetch-guard";
import { excerptFromHtml } from "../rss/excerpt";
import { parseFeed } from "../rss/parse";
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

export async function runCopywriter(_ctx: JobCtx): Promise<void> {}

export async function runDesigner(_ctx: JobCtx): Promise<void> {}

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
