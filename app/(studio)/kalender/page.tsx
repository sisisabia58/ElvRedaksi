import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import {
  formatJakartaDate,
  formatJakartaTime,
  weekDays,
  weekItems,
  weekStartFromQuery,
  ymdInJakarta,
} from "@/src/studio/calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function KalenderPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const sql = await getAppSql();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const user = token ? await userForToken(sql, token) : null;
  if (!user) {
    notFound();
  }

  const now = new Date();
  const weekStart = weekStartFromQuery(params.week, now);
  const items = await weekItems(sql, weekStart);
  const days = weekDays(weekStart);
  const prevWeek = ymdInJakarta(new Date(weekStart.getTime() - 7 * DAY_MS));
  const nextWeek = ymdInJakarta(new Date(weekStart.getTime() + 7 * DAY_MS));
  const range = `${formatJakartaDate(days[0].ymd)} – ${formatJakartaDate(days[6].ymd)}`;

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
            Kalender
          </h1>
          <p className="text-sm text-[var(--muted)]">{range}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/kalender?week=${prevWeek}`}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[var(--ink)] hover:bg-[var(--panel-2)]"
          >
            Sebelumnya
          </Link>
          <Link
            href={`/kalender?week=${nextWeek}`}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[var(--ink)] hover:bg-[var(--panel-2)]"
          >
            Berikutnya
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Belum ada yang dijadwalkan.</p>
      ) : null}

      <div className="overflow-x-auto">
        <div className="grid min-w-[720px] grid-cols-7 gap-2">
          {days.map((day) => {
            const blocks = items.filter((item) => ymdInJakarta(item.at) === day.ymd);
            return (
              <section key={day.ymd} className="min-h-40 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-2">
                <h2 className="mb-2 text-xs font-medium tracking-wide text-[var(--muted)] uppercase">
                  {day.label}{" "}
                  <span className="text-[var(--ink)]">{Number(day.ymd.slice(8))}</span>
                </h2>
                <div className="space-y-2">
                  {blocks.map((item) => (
                    <Link
                      key={item.id}
                      href={`/review/${item.id}`}
                      className="block rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1.5"
                      style={{
                        borderLeftWidth: 3,
                        borderLeftColor: item.status === "posted" ? "var(--ok)" : "var(--accent)",
                      }}
                    >
                      <span className="block font-mono text-xs text-[var(--muted)]">
                        {formatJakartaTime(item.at)}
                      </span>
                      <span className="block text-sm text-[var(--ink)]">{item.title}</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
