import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { relativeId } from "@/src/domain/metrics";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { countWaitingTopics, listTopics, type Filter } from "@/src/studio/topics";
import { RadarPanel } from "./radar-panel";

const FILTERS: Filter[] = ["passed", "all", "waiting", "skipped", "failed", "drafted"];

function parseFilter(raw: string | undefined): Filter {
  if (raw && FILTERS.includes(raw as Filter)) {
    return raw as Filter;
  }
  return "passed";
}

export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; sort?: string; q?: string }>;
}) {
  const params = await searchParams;
  const filter = parseFilter(params.filter);
  const sort = params.sort === "score" ? "score" : "new";
  const q = params.q ?? "";

  const sql = await getAppSql();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const user = token ? await userForToken(sql, token) : null;
  const canWrite = user ? can(user.role, "review.write") : false;

  const now = new Date();
  const [topics, waitingCount] = await Promise.all([
    listTopics(sql, { filter, sort, q }),
    countWaitingTopics(sql),
  ]);

  const views = topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    score: topic.score,
    state: topic.state,
    tags: topic.tags,
    sourceName: topic.sourceName,
    timeLabel: relativeId(topic.scoredAt ?? topic.discoveredAt, now),
    badge:
      topic.state === "passed"
        ? ("Lolos" as const)
        : topic.state === "skipped"
          ? ("Dilewati" as const)
          : null,
  }));

  return (
    <RadarPanel
      topics={views}
      filter={filter}
      sort={sort}
      q={q}
      waitingCount={waitingCount}
      canWrite={canWrite}
    />
  );
}
