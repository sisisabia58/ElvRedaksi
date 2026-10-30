import { normalizeKicker } from "../domain/tags";
import {
  BODY_MAX,
  CAPTION_MAX,
  CAPTION_MIN,
  FALLBACK_CTA,
  FALLBACK_HASHTAGS,
  FALLBACK_HEADLINE,
  HASHTAG_MAX,
  HASHTAG_MIN,
  HEADLINE_MAX,
  HEADLINE_MIN,
  KICKER_MAX,
  POINT_MAX,
} from "./copy-limits";

type SlideRole = "cover" | "point" | "cta";

type LooseSlide = {
  role: SlideRole;
  kicker: string;
  headline: string;
  body: string;
};

export type RepairedCopy = {
  slides: LooseSlide[];
  caption: string;
  hashtags: string[];
  altHeadlines: [string, string];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let raw = text.trim().replace(/^\uFEFF/, "");
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    raw = fenced[1].trim();
  }
  const read = (value: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "string") {
        return read(parsed);
      }
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const direct = read(raw);
  if (direct) {
    return direct;
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return read(raw.slice(start, end + 1));
  }
  return null;
}

function trimWords(text: string, max: number): string {
  const clean = asText(text);
  if (clean.length <= max) {
    return clean;
  }
  const slice = clean.slice(0, max);
  const space = slice.lastIndexOf(" ");
  return (space >= HEADLINE_MIN ? slice.slice(0, space) : slice).trim();
}

function trimAtSentence(text: string, max: number): string {
  const clean = asText(text);
  if (clean.length <= max) {
    return clean;
  }
  const slice = clean.slice(0, max);
  const end = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
    slice.lastIndexOf("…"),
  );
  if (end >= CAPTION_MIN - 1) {
    return slice.slice(0, end + 1).trim();
  }
  return trimWords(slice, max);
}

function fitHeadline(text: string, fallback: string): string {
  const trimmed = trimWords(text, HEADLINE_MAX);
  if (trimmed.length >= HEADLINE_MIN) {
    return trimmed;
  }
  const padded = trimWords(`${trimmed} ${fallback}`.trim(), HEADLINE_MAX);
  return padded.length >= HEADLINE_MIN ? padded : FALLBACK_HEADLINE;
}

function fitKicker(text: string): string {
  const trimmed = trimWords(normalizeKicker(text), KICKER_MAX);
  return trimmed || "Berita";
}

function fitBody(text: string): string {
  const trimmed = trimAtSentence(text, BODY_MAX);
  return trimmed || "Lihat rinciannya di sumber.";
}

function asRole(value: unknown): SlideRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const role = value.trim().toLowerCase();
  if (role === "cover" || role === "sampul") return "cover";
  if (role === "point" || role === "poin" || role === "isi") return "point";
  if (role === "cta" || role === "penutup" || role === "tutup") return "cta";
  return null;
}

function looseSlide(value: unknown, fallbackRole: SlideRole): LooseSlide | null {
  if (!isRecord(value)) {
    return null;
  }
  const headline = asText(value.headline);
  const body = asText(value.body);
  if (!headline && !body) {
    return null;
  }
  return {
    role: asRole(value.role) ?? fallbackRole,
    kicker: asText(value.kicker),
    headline,
    body,
  };
}

function blank(role: SlideRole, headline: string, body: string): LooseSlide {
  return { role, kicker: "Berita", headline, body };
}

function arrangeSlides(raw: unknown): LooseSlide[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const slides = raw
    .map((slide, index) => looseSlide(slide, index === 0 ? "cover" : "point"))
    .filter((slide): slide is LooseSlide => slide != null);
  if (slides.length === 0) {
    return null;
  }
  let cover = slides.find((slide) => slide.role === "cover");
  const ctaFromEnd = [...slides].reverse().find((slide) => slide.role === "cta");
  let points = slides.filter((slide) => slide !== cover && slide !== ctaFromEnd);
  if (!cover) {
    const borrowed = points.shift() ?? slides[0];
    cover = { ...borrowed, role: "cover" };
    points = points.filter((slide) => slide !== borrowed);
  }
  const cta =
    ctaFromEnd && ctaFromEnd !== cover
      ? ctaFromEnd
      : blank("cta", FALLBACK_CTA, "Artikel asli ada di sumber.");
  if (points.length > POINT_MAX) {
    points = points.slice(0, POINT_MAX);
  }
  if (points.length === 0) {
    points = [blank("point", cover.headline || FALLBACK_HEADLINE, cover.body || "Lihat rinciannya di sumber.")];
  }
  return [cover, ...points, cta].map((slide) => ({
    role: slide.role,
    kicker: fitKicker(slide.kicker),
    headline: fitHeadline(slide.headline, slide.role === "cta" ? FALLBACK_CTA : FALLBACK_HEADLINE),
    body: fitBody(slide.body),
  }));
}

function fitHashtags(raw: unknown): string[] {
  const tags = Array.isArray(raw) ? raw : [];
  const cleaned = tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((tag) => tag.length > 0);
  const unique: string[] = [];
  for (const tag of cleaned) {
    if (!unique.includes(tag)) {
      unique.push(tag);
    }
    if (unique.length >= HASHTAG_MAX) {
      break;
    }
  }
  for (const tag of FALLBACK_HASHTAGS) {
    if (unique.length >= HASHTAG_MIN) {
      break;
    }
    if (!unique.includes(tag)) {
      unique.push(tag);
    }
  }
  return unique;
}

function fitAltHeadlines(raw: unknown, coverHeadline: string): [string, string] {
  const alts = (Array.isArray(raw) ? raw : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => fitHeadline(item, FALLBACK_HEADLINE));
  const first = alts[0] || coverHeadline || FALLBACK_HEADLINE;
  const second = alts[1] || FALLBACK_CTA;
  return [first, second];
}

function fitCaption(raw: unknown, sourceName: string): string {
  const source = sourceName.trim();
  const suffix = source ? ` Sumber: ${source}.` : "";
  let caption = asText(raw);
  const namesSource = source && caption.toLowerCase().includes(source.toLowerCase());
  if (source && !namesSource) {
    caption = `${caption}${suffix}`.trim();
  }
  if (caption.length > CAPTION_MAX) {
    const sourceAt = source ? caption.toLowerCase().lastIndexOf(source.toLowerCase()) : -1;
    const base = sourceAt >= 0 ? caption.slice(0, sourceAt).trim() : caption;
    const room = Math.max(CAPTION_MIN, CAPTION_MAX - (sourceAt >= 0 ? suffix.length : 0));
    caption = `${trimAtSentence(base, room)}${sourceAt >= 0 ? suffix : ""}`.trim();
  }
  if (caption.length < CAPTION_MIN) {
    caption = `${caption} Selengkapnya di ${source || "sumber"}.`.trim();
  }
  if (caption.length > CAPTION_MAX) {
    caption = trimAtSentence(caption, CAPTION_MAX);
  }
  return caption;
}

/** Coerce a near-miss model payload into the shape parseCopy accepts. */
export function repairCopyText(text: string, sourceName: string): RepairedCopy | null {
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return null;
  }
  const slides = arrangeSlides(parsed.slides);
  if (!slides || slides.length < 3) {
    return null;
  }
  const hashtags = fitHashtags(parsed.hashtags);
  if (hashtags.length < HASHTAG_MIN) {
    return null;
  }
  return {
    slides,
    caption: fitCaption(parsed.caption, sourceName),
    hashtags,
    altHeadlines: fitAltHeadlines(parsed.altHeadlines, slides[0]?.headline ?? FALLBACK_HEADLINE),
  };
}
