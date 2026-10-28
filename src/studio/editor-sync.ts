import type { Slide } from "../agents/copywriter";
import { slidesForFormat } from "../render/html";

export type DraftFormat = "carousel_full" | "teaser_bio";

export function previewSourceIndex(format: DraftFormat, slides: Slide[], previewIndex: number): number {
  if (slides.length === 0) {
    return 0;
  }
  let picked = slides;
  try {
    picked = slidesForFormat(format, slides);
  } catch {
    picked = slides;
  }
  if (picked.length === 0) {
    return 0;
  }
  const bounded = Math.min(Math.max(previewIndex, 0), picked.length - 1);
  const slide = picked[bounded];
  const index = slides.indexOf(slide);
  return index >= 0 ? index : Math.min(bounded, slides.length - 1);
}

export function readPreviewFields(
  format: DraftFormat,
  slides: Slide[],
  previewIndex: number,
): { kicker: string; headline: string; body: string } {
  const slide = slides[previewSourceIndex(format, slides, previewIndex)];
  return {
    kicker: slide?.kicker ?? "",
    headline: slide?.headline ?? "",
    body: slide?.body ?? "",
  };
}

export function writePreviewFields(
  format: DraftFormat,
  slides: Slide[],
  previewIndex: number,
  fields: { kicker: string; headline: string; body: string },
): Slide[] {
  if (slides.length === 0) {
    return slides;
  }
  const index = previewSourceIndex(format, slides, previewIndex);
  return slides.map((slide, i) =>
    i === index
      ? { ...slide, kicker: fields.kicker, headline: fields.headline, body: fields.body }
      : slide,
  );
}

export function switchPreviewFormat(input: {
  slides: Slide[];
  fromFormat: DraftFormat;
  toFormat: DraftFormat;
  previewIndex: number;
  kicker: string;
  headline: string;
  body: string;
}): { slides: Slide[]; index: number; kicker: string; headline: string; body: string } {
  const slides = writePreviewFields(input.fromFormat, input.slides, input.previewIndex, {
    kicker: input.kicker,
    headline: input.headline,
    body: input.body,
  });
  const text = readPreviewFields(input.toFormat, slides, 0);
  return { slides, index: 0, ...text };
}

export type EditorTextFields = {
  slides: Slide[];
  kicker: string;
  headline: string;
  body: string;
  caption: string;
  hashtagsText: string;
  altHeadlines: [string, string];
};

export function editorTextFields(
  draft: {
    slides: Slide[];
    format: DraftFormat;
    caption: string;
    hashtags: string[];
    altHeadlines: [string, string];
  },
  previewIndex = 0,
): EditorTextFields {
  const text = readPreviewFields(draft.format, draft.slides, previewIndex);
  return {
    slides: draft.slides,
    kicker: text.kicker,
    headline: text.headline,
    body: text.body,
    caption: draft.caption,
    hashtagsText: draft.hashtags.join(", "),
    altHeadlines: draft.altHeadlines,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function slideTextMatches(left: Slide | undefined, right: Slide | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.kicker === right.kicker && left.headline === right.headline && left.body === right.body;
}

export function clampedFocal(value: number): number {
  return Math.min(100, Math.max(0, Math.round(Number(value))));
}

export function focalSliderIsUnsaved(savedFocal: number, sliderValue: number): boolean {
  return clampedFocal(sliderValue) !== clampedFocal(savedFocal);
}

export function editorPublishBlocked(input: {
  textDirty: boolean;
  hasUnsavedTextEdits: boolean;
  savedFocal: number;
  sliderFocal: number;
}): boolean {
  return (
    input.textDirty ||
    input.hasUnsavedTextEdits ||
    focalSliderIsUnsaved(input.savedFocal, input.sliderFocal)
  );
}

export function adoptServerDraft(
  previous: EditorTextFields,
  local: EditorTextFields,
  next: EditorTextFields,
  preview: { format: DraftFormat; index: number } = { format: "carousel_full", index: 0 },
): EditorTextFields {
  const pick = <K extends keyof EditorTextFields>(key: K): EditorTextFields[K] =>
    sameValue(local[key], previous[key]) ? next[key] : local[key];
  const localSlides = writePreviewFields(preview.format, local.slides, preview.index, {
    kicker: local.kicker,
    headline: local.headline,
    body: local.body,
  });
  const count = Math.max(localSlides.length, previous.slides.length, next.slides.length);
  const slides: Slide[] = [];
  for (let i = 0; i < count; i++) {
    const current = localSlides[i];
    const incoming = next.slides[i];
    if (slideTextMatches(current, previous.slides[i]) && incoming) {
      slides.push(incoming);
      continue;
    }
    if (current) {
      slides.push(current);
      continue;
    }
    if (incoming) {
      slides.push(incoming);
    }
  }
  const text = readPreviewFields(preview.format, slides, preview.index);
  return {
    slides,
    kicker: text.kicker,
    headline: text.headline,
    body: text.body,
    caption: pick("caption"),
    hashtagsText: pick("hashtagsText"),
    altHeadlines: pick("altHeadlines"),
  };
}
