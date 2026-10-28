import { XMLParser } from "fast-xml-parser";

export type FeedItem = {
  title: string;
  url: string;
  publishedAt: Date | null;
  summary: string;
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function textField(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "#text" in value) {
    return String((value as { "#text": unknown })["#text"] ?? "");
  }
  return String(value);
}

function resolveUrl(link: unknown): string {
  if (typeof link === "string") {
    return link.trim();
  }
  if (!link || typeof link !== "object") {
    return "";
  }
  const links = asArray(link as Record<string, string>);
  const alternate = links.find((entry) => entry["@_rel"] === "alternate");
  const chosen = alternate ?? links.find((entry) => !entry["@_rel"]) ?? links[0];
  return chosen?.["@_href"]?.trim() ?? "";
}

function validHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function parseDate(raw: unknown): Date | null {
  const text = textField(raw).trim();
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeEntry(raw: Record<string, unknown>): FeedItem | null {
  const title = textField(raw.title).trim();
  if (!title) {
    return null;
  }
  const url = validHttpUrl(resolveUrl(raw.link));
  if (!url) {
    return null;
  }
  const summary = stripTags(
    textField(raw.description) || textField(raw.summary) || textField(raw.content),
  );
  const publishedAt =
    parseDate(raw.pubDate) ?? parseDate(raw.published) ?? parseDate(raw.updated);
  return { title, url, publishedAt, summary };
}

export function parseFeed(xml: string): FeedItem[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const items: Record<string, unknown>[] = [];
  const rssChannel = (doc.rss as Record<string, unknown> | undefined)?.channel as
    | Record<string, unknown>
    | undefined;
  if (rssChannel) {
    items.push(...asArray(rssChannel.item as Record<string, unknown> | Record<string, unknown>[]));
  }
  const atomFeed = doc.feed as Record<string, unknown> | undefined;
  if (atomFeed) {
    items.push(...asArray(atomFeed.entry as Record<string, unknown> | Record<string, unknown>[]));
  }

  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const raw of items) {
    const item = normalizeEntry(raw);
    if (!item || seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
