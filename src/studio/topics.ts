import type { Sql } from "../db/client";

export type Filter = "passed" | "all" | "waiting" | "skipped" | "failed" | "drafted";

export type TopicListItem = {
  id: string;
  title: string;
  url: string;
  score: number | null;
  state: string;
  tags: string[];
  sensitive: boolean;
  sourceName: string;
  discoveredAt: Date;
  scoredAt: Date | null;
};

const STATE_BY_FILTER: Record<Exclude<Filter, "all">, string> = {
  passed: "passed",
  waiting: "new",
  skipped: "skipped",
  failed: "failed",
  drafted: "drafted",
};

export async function listTopics(
  sql: Sql,
  query: { filter: Filter; sort: "new" | "score"; q: string },
): Promise<TopicListItem[]> {
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];

  if (query.filter !== "all") {
    params.push(STATE_BY_FILTER[query.filter]);
    clauses.push(`t.state = $${params.length}`);
  }

  const q = query.q.trim();
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`t.title ilike $${params.length}`);
  }

  const order =
    query.sort === "score" ? "t.score desc nulls last, t.discovered_at desc" : "t.discovered_at desc";

  const rows = await sql.rows<{
    id: string;
    title: string;
    url: string;
    score: number | null;
    state: string;
    tags: string[] | unknown;
    sensitive: boolean;
    source_name: string;
    discovered_at: Date;
    scored_at: Date | null;
  }>(
    `select t.id, t.title, t.url, t.score, t.state, t.tags, t.sensitive,
            s.name as source_name, t.discovered_at, t.scored_at
     from topics t
     join sources s on s.id = t.source_id
     where ${clauses.join(" and ")}
     order by ${order}`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    score: row.score,
    state: row.state,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    sensitive: row.sensitive,
    sourceName: row.source_name,
    discoveredAt: row.discovered_at,
    scoredAt: row.scored_at,
  }));
}

export async function countWaitingTopics(sql: Sql): Promise<number> {
  const rows = await sql.rows<{ count: string }>(
    "select count(*)::int as count from topics where state = 'new'",
  );
  return Number(rows[0]?.count ?? 0);
}
