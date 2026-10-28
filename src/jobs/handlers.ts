import { randomUUID } from "node:crypto";
import { SCOUT_INTERVAL_MS } from "../domain/constants";
import { assertPublicFetchUrl, fetchPublicText } from "../rss/fetch-guard";
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
      await assertPublicFetchUrl(source.url);
      const xml = await ctx.fetchFeed(source.url);
      const items = parseFeed(xml);

      for (const item of items) {
        let excerpt = "";
        try {
          await assertPublicFetchUrl(item.url);
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

export async function runAnalyst(_ctx: JobCtx): Promise<void> {}

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
