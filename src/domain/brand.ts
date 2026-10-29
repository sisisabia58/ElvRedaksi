export const COVER_NAVY = "#172339";
export const PAPER = "#F7F5F2";
export const SLATE = "#647182";
export const DEFAULT_ACCENT = "#4E708C";
export const BRAND_NAME = "Analyst Digest";

export const SLIDE_TEMPLATES = ["stabilo", "foto_penuh", "serif", "catatan", "berita_pro"] as const;

export type SlideTemplateName = (typeof SLIDE_TEMPLATES)[number];

export function clampSlideCount(value: unknown): 2 | 3 {
  const parsed = typeof value === "number" ? value : Number(value);
  return parsed === 2 ? 2 : 3;
}

export function safeAccent(accent: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_ACCENT;
}
