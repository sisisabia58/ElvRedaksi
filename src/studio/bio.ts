import type { Sql } from "../db/client";
import { isBlockedFetchTarget } from "../rss/fetch-guard";

export type BioItem = {
  code: string;
  sourceName: string;
  title: string;
  assetId: string;
};

export type BioGrid = {
  handle: string;
  initial: string;
  items: BioItem[];
};

function coverTitle(slides: unknown, fallback: string): string {
  let list: { role?: string; headline?: string }[] = [];
  if (typeof slides === "string") {
    try {
      const parsed = JSON.parse(slides) as unknown;
      if (Array.isArray(parsed)) {
        list = parsed as { role?: string; headline?: string }[];
      }
    } catch {
      list = [];
    }
  } else if (Array.isArray(slides)) {
    list = slides as { role?: string; headline?: string }[];
  }
  const cover = list.find((slide) => slide?.role === "cover") ?? list[0];
  const headline = cover?.headline;
  return typeof headline === "string" && headline.trim() ? headline.trim() : fallback;
}

export async function bioGrid(sql: Sql): Promise<BioGrid> {
  const brandRows = await sql.rows<{ handle: string; initial: string }>(
    "select handle, initial from brand where id = 1",
  );
  const rows = await sql.rows<{
    code: string;
    source_name: string;
    topic_title: string;
    slides: unknown;
    asset_id: string | null;
  }>(
    `select d.short_code as code,
            s.name as source_name,
            t.title as topic_title,
            d.slides,
            (
              select a.id from assets a
              where a.draft_id = d.id
              order by a.slide_index
              limit 1
            ) as asset_id
     from drafts d
     join topics t on t.id = d.topic_id
     join sources s on s.id = t.source_id
     where d.status = 'posted' and d.format = 'teaser_bio'
     order by d.posted_at desc nulls last
     limit 60`,
  );
  return {
    handle: brandRows[0]?.handle ?? "",
    initial: brandRows[0]?.initial ?? "",
    items: rows.map((row) => ({
      code: row.code,
      sourceName: row.source_name,
      title: coverTitle(row.slides, row.topic_title),
      assetId: row.asset_id ?? "",
    })),
  };
}

export async function resolveShortLink(
  sql: Sql,
  code: string,
  prefetch: boolean,
): Promise<{ location: string; counted: boolean } | null> {
  const rows = await sql.rows<{ url: string }>(
    `select t.url
     from drafts d
     join topics t on t.id = d.topic_id
     where d.short_code = $1`,
    [code],
  );
  const location = rows[0]?.url;
  if (!location) return null;
  if (await isBlockedFetchTarget(location)) return null;
  if (prefetch) return { location, counted: false };
  await sql.rows("update drafts set click_count = click_count + 1 where short_code = $1", [code]);
  return { location, counted: true };
}
