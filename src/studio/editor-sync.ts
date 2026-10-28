import type { Slide } from "../agents/copywriter";

export type EditorTextFields = {
  slides: Slide[];
  kicker: string;
  headline: string;
  body: string;
  caption: string;
  hashtagsText: string;
  altHeadlines: [string, string];
};

export function editorTextFields(draft: {
  slides: Slide[];
  caption: string;
  hashtags: string[];
  altHeadlines: [string, string];
}): EditorTextFields {
  const cover = draft.slides.find((slide) => slide.role === "cover") ?? draft.slides[0];
  return {
    slides: draft.slides,
    kicker: cover?.kicker ?? "",
    headline: cover?.headline ?? "",
    body: cover?.body ?? "",
    caption: draft.caption,
    hashtagsText: draft.hashtags.join(", "),
    altHeadlines: draft.altHeadlines,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function adoptServerDraft(
  previous: EditorTextFields,
  local: EditorTextFields,
  next: EditorTextFields,
): EditorTextFields {
  const pick = <K extends keyof EditorTextFields>(key: K): EditorTextFields[K] =>
    sameValue(local[key], previous[key]) ? next[key] : local[key];
  return {
    slides: pick("slides"),
    kicker: pick("kicker"),
    headline: pick("headline"),
    body: pick("body"),
    caption: pick("caption"),
    hashtagsText: pick("hashtagsText"),
    altHeadlines: pick("altHeadlines"),
  };
}
