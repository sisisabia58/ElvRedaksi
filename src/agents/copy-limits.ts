/** Limits parseCopy enforces after a near-miss is repaired. The prompt quotes these same numbers. */
export const HEADLINE_MIN = 8;
export const HEADLINE_MAX = 120;
export const BODY_MAX = 1600;
export const CAPTION_MIN = 20;
export const CAPTION_MAX = 500;
export const HASHTAG_MIN = 3;
export const HASHTAG_MAX = 8;
export const KICKER_MAX = 40;
export const POINT_MIN = 1;
export const POINT_MAX = 5;
export const FALLBACK_HASHTAGS = ["berita", "indonesia", "terkini"] as const;
export const FALLBACK_HEADLINE = "Baca selengkapnya";
export const FALLBACK_CTA = "Baca selengkapnya di link bio";
