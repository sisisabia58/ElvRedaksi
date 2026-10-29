import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { TIME_ZONE } from "@/src/domain/constants";
import {
  analyticsView,
  followerLineCoordinates,
  parseAnalyticsSort,
  type AnalyticsPost,
  type AnalyticsSort,
  type DailyPoint,
  type MetricCard,
} from "@/src/studio/analytics";
import { getSettings } from "@/src/studio/settings";
import { SyncInsightsButton } from "./sync-button";

const RANGES = [7, 28, 90] as const;

const SORT_COLUMNS: { sort: AnalyticsSort; label: string }[] = [
  { sort: "views", label: "Views" },
  { sort: "reach", label: "Reach" },
  { sort: "likes", label: "Likes" },
  { sort: "komentar", label: "Komentar" },
  { sort: "saves", label: "Saves" },
  { sort: "shares", label: "Shares" },
  { sort: "er", label: "ER" },
];

function parseDays(raw: string | undefined): 7 | 28 | 90 {
  if (raw === "7") return 7;
  if (raw === "90") return 90;
  return 28;
}

function pageHref(days: 7 | 28 | 90, sort: AnalyticsSort): string {
  return `/analitik?days=${days}&sort=${sort}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}

function formatDelta(delta: number, kind: MetricCard["deltaKind"]): string {
  const formatted = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: kind === "percent" ? 1 : 0,
    minimumFractionDigits: 0,
  }).format(Math.abs(delta));
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const body = `${sign}${formatted}`;
  return kind === "percent" ? `${body}%` : body;
}

function formatEr(value: number): string {
  const formatted = new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted}%`;
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatDay(ymd: string): string {
  return formatWhen(new Date(`${ymd}T12:00:00+07:00`));
}

function formatName(format: string): string {
  if (format === "carousel_full") return "Carousel penuh";
  if (format === "teaser_bio") return "Teaser + link bio";
  return format;
}

function deltaStyle(delta: number): { color: string } {
  if (delta > 0) return { color: "#34d399" };
  if (delta < 0) return { color: "#f87171" };
  return { color: "var(--muted)" };
}

export default async function AnalitikPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const days = parseDays(params.days);
  const sort = parseAnalyticsSort(params.sort);
  const sql = await getAppSql();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const user = token ? await userForToken(sql, token) : null;
  if (!user) {
    notFound();
  }

  const now = new Date();
  const [view, settings] = await Promise.all([analyticsView(sql, days, now, sort), getSettings(sql)]);
  const handle = (settings.igUsername || settings.handle).replace(/^@/, "");
  const canSync = can(user.role, "review.write");

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
            {handle ? `INSTAGRAM · @${handle}` : "INSTAGRAM"}
          </p>
          <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
            ANALITIK
          </h1>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-2">
            {RANGES.map((range) => (
              <Link
                key={range}
                href={pageHref(range, sort)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  days === range
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--ink)]"
                }`}
              >
                {range} hari
              </Link>
            ))}
          </div>
          {canSync ? <SyncInsightsButton /> : null}
        </div>
      </div>

      {view.empty ? (
        <p className="text-sm text-[var(--muted)]">
          Hubungkan Instagram di Pengaturan. Angka di sini hanya dari API resmi.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricTile label="Followers" card={view.followers} />
            <MetricTile label="Views" card={view.views} />
            <MetricTile label="Reach" card={view.reach} />
            <MetricTile label="Interaksi" card={view.interactions} />
            <MetricTile label="Akun berinteraksi" card={view.accountsEngaged} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Views harian">
              <ViewsBars daily={view.daily} />
            </ChartCard>
            <ChartCard title="Pertumbuhan followers">
              <FollowersLine daily={view.daily} />
            </ChartCard>
          </div>

          <details className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-[var(--ink)]">Lihat tabel harian</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-[var(--muted)]">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Tanggal</th>
                    <th className="py-2 pr-3 font-medium">Views</th>
                    <th className="py-2 pr-3 font-medium">Reach</th>
                    <th className="py-2 font-medium">Followers</th>
                  </tr>
                </thead>
                <tbody>
                  {view.daily.map((point) => (
                    <tr key={point.date} className="border-t border-[var(--line)]">
                      <td className="py-2 pr-3 text-[var(--ink)]">{formatDay(point.date)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatCount(point.views)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatCount(point.reach)}</td>
                      <td className="py-2 tabular-nums">
                        {point.followers == null ? "–" : formatCount(point.followers)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--panel)]">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium" />
                  <th className="px-3 py-2 font-medium">Judul</th>
                  <th className="px-3 py-2 font-medium">
                    <SortLink days={days} sort="terbaru" current={sort} label="Terbaru" />
                  </th>
                  <th className="px-3 py-2 font-medium">Format</th>
                  {SORT_COLUMNS.map((column) => (
                    <th key={column.sort} className="px-3 py-2 font-medium">
                      <SortLink days={days} sort={column.sort} current={sort} label={column.label} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.posts.map((post) => (
                  <PostRow key={post.id} post={post} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SortLink({
  days,
  sort,
  current,
  label,
}: {
  days: 7 | 28 | 90;
  sort: AnalyticsSort;
  current: AnalyticsSort;
  label: string;
}) {
  return (
    <Link href={pageHref(days, sort)} className={current === sort ? "text-[var(--accent)]" : "hover:text-[var(--ink)]"}>
      {label}
    </Link>
  );
}

function MetricTile({ label, card }: { label: string; card: MetricCard }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-2">
      <p className="text-xs font-medium tracking-wide text-[var(--muted)]">{label}</p>
      <p className="text-3xl font-semibold tabular-nums text-[var(--ink)]">
        {card.value == null ? "–" : formatCount(card.value)}
      </p>
      {card.delta != null ? (
        <p className="text-sm font-medium tabular-nums" style={deltaStyle(card.delta)}>
          {formatDelta(card.delta, card.deltaKind)}
        </p>
      ) : null}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-3">
      <h2 className="text-sm font-medium text-[var(--ink)]">{title}</h2>
      {children}
    </section>
  );
}

function ViewsBars({ daily }: { daily: DailyPoint[] }) {
  if (daily.length === 0) return null;
  const width = 640;
  const height = 160;
  const gap = 3;
  const max = Math.max(...daily.map((point) => point.views), 0);
  const barWidth = (width - gap * Math.max(daily.length - 1, 0)) / daily.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Views harian" className="h-40 w-full">
      {daily.map((point, index) => {
        const barHeight = max === 0 ? 0 : (point.views / max) * (height - 4);
        return (
          <rect
            key={point.date}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={Math.max(barWidth, 0)}
            height={barHeight}
            fill="#d7ff3a"
            rx="2"
          >
            <title>{`${point.date}: ${formatCount(point.views)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function FollowersLine({ daily }: { daily: DailyPoint[] }) {
  const width = 640;
  const height = 160;
  const coords = followerLineCoordinates(daily, width, height);
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of coords) {
    if (point == null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  if (segments.length === 0) return null;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pertumbuhan followers" className="h-40 w-full">
      {segments.map((segment, index) =>
        segment.length === 1 ? (
          <circle key={index} cx={segment[0].x} cy={segment[0].y} r="3.5" fill="#34d399" />
        ) : (
          <polyline
            key={index}
            fill="none"
            stroke="#34d399"
            strokeWidth="2"
            points={segment.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}
          />
        ),
      )}
    </svg>
  );
}

function PostRow({ post }: { post: AnalyticsPost }) {
  const showThumb = post.assetId != null && (post.status === "posted" || post.status === "posting");
  return (
    <tr className="border-t border-[var(--line)]">
      <td className="px-3 py-2">
        {showThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/media/${post.assetId}`} alt="" className="aspect-[4/5] w-10 rounded object-cover" />
        ) : (
          <span className="block aspect-[4/5] w-10 rounded bg-[var(--panel-2)]" />
        )}
      </td>
      <td className="px-3 py-2 text-[var(--ink)]">
        <Link href={`/review/${post.id}`} className="hover:text-[var(--accent)]">
          {post.title}
        </Link>
      </td>
      <td className="px-3 py-2 text-[var(--muted)]">{post.postedAt ? formatWhen(post.postedAt) : "–"}</td>
      <td className="px-3 py-2">{formatName(post.format)}</td>
      <td className="px-3 py-2 tabular-nums">{formatCount(post.views)}</td>
      <td className="px-3 py-2 tabular-nums">{formatCount(post.reach)}</td>
      <td className="px-3 py-2 tabular-nums">{formatCount(post.likes)}</td>
      <td className="px-3 py-2 tabular-nums">{formatCount(post.comments)}</td>
      <td className="px-3 py-2 tabular-nums">{formatCount(post.saves)}</td>
      <td className="px-3 py-2 tabular-nums">{formatCount(post.shares)}</td>
      <td className="px-3 py-2 tabular-nums">{formatEr(post.er)}</td>
    </tr>
  );
}
