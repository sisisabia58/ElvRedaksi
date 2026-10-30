import { z } from "zod";
import {
  BODY_MAX,
  CAPTION_MAX,
  CAPTION_MIN,
  HASHTAG_MAX,
  HASHTAG_MIN,
  HEADLINE_MAX,
  HEADLINE_MIN,
} from "./copy-limits";
import { repairCopyText } from "./copy-repair";
import { normalizeKicker } from "../domain/tags";
import { fitSlideBody } from "../render/fit-body";

export type Slide = {
  role: "cover" | "point" | "cta";
  kicker: string;
  headline: string;
  body: string;
};

export type DraftCopy = {
  slides: Slide[];
  caption: string;
  hashtags: string[];
  altHeadlines: [string, string];
};

const slideSchema = z.object({
  role: z.enum(["cover", "point", "cta"]),
  kicker: z.string(),
  headline: z.string().min(HEADLINE_MIN).max(HEADLINE_MAX),
  body: z.string().min(1).max(BODY_MAX),
});

const hashtagSchema = z.string().regex(/^[a-z0-9]+$/);

function invalid(): never {
  throw new Error("naskah tidak valid");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop a source credit parked after the sentence. The Sumber line already names it. */
export function stripTrailingSource(body: string, sourceName: string): string {
  const original = body.trim();
  if (!original) {
    return original;
  }
  const names = [sourceName.trim(), "ANTARA Terkini", "ANTARA"].filter(
    (name, index, all) => name.length > 0 && all.indexOf(name) === index,
  );
  names.sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = new RegExp(`([.!?…])\\s+\\(?\\s*${escapeRegExp(name)}\\s*\\)?\\s*$`, "i");
    if (!pattern.test(original)) {
      continue;
    }
    const next = original.replace(pattern, "$1").trim();
    if (next.length >= 8 && next !== original) {
      return next;
    }
  }
  return original;
}

export function parseCopy(text: string, sourceName: string): DraftCopy {
  const repaired = repairCopyText(text, sourceName);
  if (!repaired) {
    invalid();
  }

  const root = z
    .object({
      slides: z.array(z.unknown()),
      caption: z.string().min(CAPTION_MIN).max(CAPTION_MAX),
      hashtags: z.array(hashtagSchema).min(HASHTAG_MIN).max(HASHTAG_MAX),
      altHeadlines: z.array(z.string()).length(2),
    })
    .safeParse(repaired);

  if (!root.success) {
    invalid();
  }

  const { slides: rawSlides, caption, hashtags, altHeadlines } = root.data;

  if (!caption.toLowerCase().includes(sourceName.toLowerCase())) {
    invalid();
  }

  const slideCount = rawSlides.length;
  const pointCount = slideCount - 2;
  if (pointCount < 1 || pointCount > 5) {
    invalid();
  }

  const slides: Slide[] = [];
  for (let i = 0; i < slideCount; i++) {
    const expectedRole = i === 0 ? "cover" : i === slideCount - 1 ? "cta" : "point";
    const slideResult = slideSchema.safeParse(rawSlides[i]);
    if (!slideResult.success || slideResult.data.role !== expectedRole) {
      invalid();
    }
    slides.push({
      ...slideResult.data,
      kicker: normalizeKicker(slideResult.data.kicker),
      body: fitSlideBody(stripTrailingSource(slideResult.data.body, sourceName)).text,
    });
  }

  return {
    slides,
    caption,
    hashtags,
    altHeadlines: [altHeadlines[0], altHeadlines[1]],
  };
}
