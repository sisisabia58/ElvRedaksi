import type { Sql } from "../db/client";
import { TIME_ZONE } from "../domain/constants";

export type WeekItem = {
  id: string;
  title: string;
  at: Date;
  status: "scheduled" | "posted";
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

type CalendarParts = { year: number; month: number; day: number; weekday: string };

function calendarParts(date: Date, timeZone: string): CalendarParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    weekday: bag.weekday ?? "Mon",
  };
}

function clockParts(date: Date, timeZone: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return { hour: Number(bag.hour), minute: Number(bag.minute) };
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const rough = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let offsetMs = -14 * 3600_000; offsetMs <= 14 * 3600_000; offsetMs += 60_000) {
    const candidate = new Date(rough + offsetMs);
    const cal = calendarParts(candidate, timeZone);
    if (cal.year !== year || cal.month !== month || cal.day !== day) {
      continue;
    }
    const clock = clockParts(candidate, timeZone);
    if (clock.hour === 0 && clock.minute === 0) {
      return candidate;
    }
  }
  throw new Error("could not resolve zoned instant");
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function ymdInJakarta(date: Date): string {
  const parts = calendarParts(date, TIME_ZONE);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function formatJakartaDate(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatJakartaTime(date: Date): string {
  const { hour, minute } = clockParts(date, TIME_ZONE);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function mondayContaining(instant: Date): Date {
  const parts = calendarParts(instant, TIME_ZONE);
  const index = WEEKDAY_INDEX[parts.weekday] ?? 0;
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - index));
  return zonedMidnight(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), TIME_ZONE);
}

export function weekStartFromQuery(week: string | undefined, now: Date): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week ?? "");
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (isRealDate(year, month, day)) {
      return mondayContaining(zonedMidnight(year, month, day, TIME_ZONE));
    }
  }
  return mondayContaining(now);
}

export function weekDays(weekStart: Date): { label: (typeof WEEKDAY_LABELS)[number]; ymd: string }[] {
  return WEEKDAY_LABELS.map((label, index) => ({
    label,
    ymd: ymdInJakarta(new Date(weekStart.getTime() + index * DAY_MS)),
  }));
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function coverHeadline(slides: unknown, fallback: string): string {
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
  return typeof headline === "string" && headline.trim() ? headline : fallback;
}

export async function weekItems(sql: Sql, weekStart: Date): Promise<WeekItem[]> {
  const startMs = weekStart.getTime();
  const endMs = startMs + WEEK_MS;
  const rows = await sql.rows<{
    id: string;
    status: string;
    scheduled_at: Date | string | null;
    posted_at: Date | string | null;
    slides: unknown;
    topic_title: string;
  }>(
    `select d.id, d.status, d.scheduled_at, d.posted_at, d.slides, t.title as topic_title
     from drafts d
     join topics t on t.id = d.topic_id
     where d.status in ('scheduled', 'posted')`,
  );

  const items: WeekItem[] = [];
  for (const row of rows) {
    if (row.status !== "scheduled" && row.status !== "posted") {
      continue;
    }
    const raw = row.status === "posted" ? row.posted_at : row.scheduled_at;
    if (raw == null) {
      continue;
    }
    const at = asDate(raw);
    const time = at.getTime();
    if (Number.isNaN(time) || time < startMs || time >= endMs) {
      continue;
    }
    items.push({
      id: row.id,
      title: coverHeadline(row.slides, row.topic_title),
      at,
      status: row.status,
    });
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());
  return items;
}
