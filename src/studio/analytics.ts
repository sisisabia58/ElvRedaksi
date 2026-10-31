import type { Sql } from "../db/client";
import { TIME_ZONE } from "../domain/constants";
import { deltaPct, engagementRate } from "../domain/metrics";

export type DailyPoint = { date: string; views: number; reach: number; followers: number | null };

export type InsightPostInput = {
  igMediaId: string;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
};

export type NormalizedSnapshot = {
  followers: number;
  views: number;
  reach: number;
  interactions: number;
  accountsEngaged: number | null;
  daily: DailyPoint[];
};

export type MetricCard = {
  value: number | null;
  delta: number | null;
  deltaKind: "absolute" | "percent";
};

export const ANALYTICS_SORTS = [
  "terbaru",
  "views",
  "reach",
  "likes",
  "komentar",
  "saves",
  "shares",
  "er",
] as const;

export type AnalyticsSort = (typeof ANALYTICS_SORTS)[number];

export type AnalyticsPost = {
  id: string;
  title: string;
  postedAt: Date | null;
  format: string;
  status: string;
  assetId: string | null;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  er: number;
};

export type AnalyticsView = {
  empty: boolean;
  connected: boolean;
  syncError: string | null;
  lastSyncedAt: Date | null;
  viewsWindowNote: string | null;
  followers: MetricCard;
  views: MetricCard;
  reach: MetricCard;
  interactions: MetricCard;
  accountsEngaged: MetricCard;
  daily: DailyPoint[];
  posts: AnalyticsPost[];
};

const FOLLOWER_CHART_PAD = 8;

export function followerLineCoordinates(
  daily: readonly { followers: number | null }[],
  width: number,
  height: number,
): Array<{ x: number; y: number } | null> {
  const values = daily.flatMap((point) => (point.followers == null ? [] : [point.followers]));
  if (values.length === 0) return daily.map(() => null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const last = daily.length - 1;
  return daily.map((point, index) => {
    if (point.followers == null) return null;
    const x = last === 0 ? width / 2 : (index / last) * width;
    const y =
      span === 0
        ? height / 2
        : height - FOLLOWER_CHART_PAD - ((point.followers - min) / span) * (height - FOLLOWER_CHART_PAD * 2);
    return { x, y };
  });
}

type SnapshotRow = {
  id: string;
  taken_at: Date | string;
  followers: number;
  views: number;
  reach: number;
  interactions: number;
  accounts_engaged: number | null;
  daily: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFollowers(value: unknown): number | null | undefined {
  if (value == null) return null;
  const parsed = asCount(value);
  return parsed == null ? undefined : parsed;
}

function asCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function jakartaYmd(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function windows(now: Date, days: number) {
  const currentEnd = jakartaYmd(now);
  const currentStart = addCalendarDays(currentEnd, -(days - 1));
  const previousEnd = addCalendarDays(currentStart, -1);
  const previousStart = addCalendarDays(previousEnd, -(days - 1));
  return { currentStart, currentEnd, previousStart, previousEnd };
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

// Asia/Jakarta is UTC+7 all year. Midnight bounds keep snapshot windows on the same dates as the chart.
function jakartaDayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+07:00`);
}

function asDaily(raw: unknown): DailyPoint[] {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const points: DailyPoint[] = [];
  for (const item of parsed) {
    if (!isRecord(item) || typeof item.date !== "string") continue;
    const views = asCount(item.views);
    const reach = asCount(item.reach);
    const followers = asFollowers(item.followers);
    if (views == null || reach == null || followers === undefined) continue;
    points.push({ date: item.date, views, reach, followers });
  }
  return points;
}

function sliceDaily(daily: DailyPoint[], start: string, end: string): DailyPoint[] {
  return daily.filter((point) => inRange(point.date, start, end)).sort((a, b) => a.date.localeCompare(b.date));
}

function sumKey(points: DailyPoint[], key: "views" | "reach"): number {
  return points.reduce((total, point) => total + point[key], 0);
}

function emptyView(): AnalyticsView {
  return {
    empty: true,
    connected: false,
    syncError: null,
    lastSyncedAt: null,
    viewsWindowNote: null,
    followers: { value: null, delta: null, deltaKind: "absolute" },
    views: { value: null, delta: null, deltaKind: "percent" },
    reach: { value: null, delta: null, deltaKind: "percent" },
    interactions: { value: null, delta: null, deltaKind: "percent" },
    accountsEngaged: { value: null, delta: null, deltaKind: "percent" },
    daily: [],
    posts: [],
  };
}

export function normalizeInsights(input: {
  followers: number;
  daily: DailyPoint[];
  accountsEngaged: number | null;
  posts: InsightPostInput[];
  /** Facebook `views` is a window total, not a daily series. */
  viewsTotal?: number | null;
}): { snapshot: NormalizedSnapshot; posts: InsightPostInput[] } {
  const summedViews = input.daily.reduce((total, point) => total + point.views, 0);
  const views = input.viewsTotal != null ? input.viewsTotal : summedViews;
  const reach = input.daily.reduce((total, point) => total + point.reach, 0);
  const interactions = input.posts.reduce(
    (total, post) => total + post.likes + post.comments + post.saves + post.shares,
    0,
  );
  return {
    snapshot: {
      followers: input.followers,
      views,
      reach,
      interactions,
      accountsEngaged: input.accountsEngaged,
      daily: input.daily,
    },
    posts: input.posts,
  };
}

function isSort(value: string): value is AnalyticsSort {
  return (ANALYTICS_SORTS as readonly string[]).includes(value);
}

export function parseAnalyticsSort(raw: string | undefined): AnalyticsSort {
  if (raw && isSort(raw)) return raw;
  return "terbaru";
}

function sortPosts(posts: AnalyticsPost[], sort: AnalyticsSort): AnalyticsPost[] {
  const metric = (post: AnalyticsPost): number => {
    switch (sort) {
      case "views":
        return post.views;
      case "reach":
        return post.reach;
      case "likes":
        return post.likes;
      case "komentar":
        return post.comments;
      case "saves":
        return post.saves;
      case "shares":
        return post.shares;
      case "er":
        return post.er;
      default:
        return 0;
    }
  };
  return [...posts].sort((a, b) => {
    if (sort !== "terbaru") {
      const diff = metric(b) - metric(a);
      if (diff !== 0) return diff;
    }
    const aTime = a.postedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bTime = b.postedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (bTime !== aTime) return bTime - aTime;
    return a.id.localeCompare(b.id);
  });
}

type ConnectionRow = {
  ig_user_id: string | null;
  access_token: string | null;
  api_host: string | null;
  insights_error: string | null;
  insights_synced_at: Date | string | null;
};

async function insightConnection(sql: Sql): Promise<{
  connected: boolean;
  syncError: string | null;
  lastSyncedAt: Date | null;
  facebook: boolean;
}> {
  const rows = await sql.rows<ConnectionRow>(
    `select ig_user_id, access_token, api_host, insights_error, insights_synced_at
     from ig_connection where id = 1`,
  );
  const row = rows[0];
  if (!row) {
    return { connected: false, syncError: null, lastSyncedAt: null, facebook: false };
  }
  const synced = row.insights_synced_at;
  return {
    connected: Boolean(row.ig_user_id?.trim() && row.access_token?.trim()),
    syncError: row.insights_error?.trim() ? row.insights_error.trim() : null,
    lastSyncedAt: synced == null ? null : asDate(synced),
    facebook: row.api_host === "facebook",
  };
}

export async function analyticsView(
  sql: Sql,
  days: 7 | 28 | 90,
  now: Date,
  sort: AnalyticsSort = "terbaru",
): Promise<AnalyticsView> {
  const link = await insightConnection(sql);
  const latest = await sql.rows<SnapshotRow>(
    `select id, taken_at, followers, views, reach, interactions, accounts_engaged, daily
     from insight_snapshots
     order by taken_at desc
     limit 1`,
  );
  const snapshot = latest[0];
  if (!snapshot) {
    return {
      ...emptyView(),
      connected: link.connected,
      syncError: link.syncError,
      lastSyncedAt: link.lastSyncedAt,
    };
  }

  const { currentStart, currentEnd, previousStart, previousEnd } = windows(now, days);
  const daily = asDaily(snapshot.daily);
  const currentDaily = sliceDaily(daily, currentStart, currentEnd);
  const previousDaily = sliceDaily(daily, previousStart, previousEnd);
  const currentLast = currentDaily[currentDaily.length - 1];
  const previousLast = previousDaily[previousDaily.length - 1];
  const currentFollowers = currentLast?.followers ?? null;
  const previousFollowers = previousLast?.followers ?? null;

  const previousRows = await sql.rows<{
    interactions: number;
    accounts_engaged: number | null;
  }>(
    `select interactions, accounts_engaged
     from insight_snapshots
     where id <> $1 and taken_at >= $2 and taken_at < $3
     order by taken_at desc
     limit 1`,
    [snapshot.id, jakartaDayStart(previousStart), jakartaDayStart(addCalendarDays(previousEnd, 1))],
  );
  const previousSnapshot = previousRows[0];

  const followers = asCount(snapshot.followers) ?? 0;
  const interactions = asCount(snapshot.interactions) ?? 0;
  const accountsEngaged = snapshot.accounts_engaged == null ? null : asCount(snapshot.accounts_engaged);
  const windowViews = sumKey(currentDaily, "views");
  const snapshotViews = asCount(snapshot.views) ?? 0;
  const viewsFromWindow = link.facebook && windowViews === 0;
  const viewsValue = viewsFromWindow ? snapshotViews : windowViews;
  const reachValue = sumKey(currentDaily, "reach");

  const posts = await loadPosts(sql);

  return {
    empty: false,
    connected: link.connected,
    syncError: link.syncError,
    lastSyncedAt: link.lastSyncedAt,
    viewsWindowNote: viewsFromWindow
      ? "Total jendela sinkron (±29 hari), bukan jumlah harian."
      : null,
    followers: {
      value: followers,
      delta:
        currentFollowers == null || previousFollowers == null ? null : currentFollowers - previousFollowers,
      deltaKind: "absolute",
    },
    views: {
      value: viewsValue,
      delta: viewsFromWindow ? null : deltaPct(viewsValue, sumKey(previousDaily, "views")),
      deltaKind: "percent",
    },
    reach: {
      value: reachValue,
      delta: deltaPct(reachValue, sumKey(previousDaily, "reach")),
      deltaKind: "percent",
    },
    interactions: {
      value: interactions,
      delta: previousSnapshot ? deltaPct(interactions, asCount(previousSnapshot.interactions) ?? 0) : null,
      deltaKind: "percent",
    },
    accountsEngaged: {
      value: accountsEngaged,
      delta:
        previousSnapshot && accountsEngaged != null && previousSnapshot.accounts_engaged != null
          ? deltaPct(accountsEngaged, asCount(previousSnapshot.accounts_engaged) ?? 0)
          : null,
      deltaKind: "percent",
    },
    daily: currentDaily,
    posts: sortPosts(posts, sort),
  };
}

async function loadPosts(sql: Sql): Promise<AnalyticsPost[]> {
  const rows = await sql.rows<{
    id: string;
    title: string;
    posted_at: Date | string | null;
    format: string;
    status: string;
    asset_id: string | null;
    views: number;
    reach: number;
    likes: number;
    comments: number;
    saves: number;
    shares: number;
  }>(
    `select d.id, t.title, d.posted_at, d.format, d.status,
            (select a.id from assets a where a.draft_id = d.id order by a.slide_index limit 1) as asset_id,
            p.views, p.reach, p.likes, p.comments, p.saves, p.shares
     from post_insights p
     join drafts d on d.id = p.draft_id
     join topics t on t.id = d.topic_id`,
  );
  return rows.map((row) => {
    const views = asCount(row.views) ?? 0;
    const likes = asCount(row.likes) ?? 0;
    const comments = asCount(row.comments) ?? 0;
    const saves = asCount(row.saves) ?? 0;
    const shares = asCount(row.shares) ?? 0;
    return {
      id: row.id,
      title: row.title,
      postedAt: row.posted_at == null ? null : asDate(row.posted_at),
      format: row.format,
      status: row.status,
      assetId: row.asset_id,
      views,
      reach: asCount(row.reach) ?? 0,
      likes,
      comments,
      saves,
      shares,
      er: engagementRate({ views, likes, comments, saves, shares }),
    };
  });
}
