import { stripTrailingSource, type Slide } from "../agents/copywriter";
import { COVER_NAVY, PAPER, SLATE, safeAccent } from "../domain/brand";
import { contrastRatio, onAccentText } from "../domain/contrast";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "../domain/constants";
import { fontFaceCss } from "./fonts";

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function safePhotoDataUrl(photoDataUrl: string | null | undefined): string | null {
  if (!photoDataUrl || photoDataUrl.trim() !== photoDataUrl || /[\s"']/.test(photoDataUrl)) {
    return null;
  }
  return SAFE_DATA_IMAGE.test(photoDataUrl) ? photoDataUrl : null;
}

export type BeritaProInput = {
  slide: Slide;
  index: number;
  total: number;
  handle: string;
  sourceName: string;
  accent: string;
  focalY: number;
  photoDataUrl: string | null;
  logoDataUrl?: string | null;
  initial?: string;
};

export function coverHeadlinePx(headline: string): number {
  const text = headline.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = text.length;
  if (words <= 4 && chars <= 28) return 92;
  if (words <= 8 && chars <= 64) return 80;
  if (words <= 12 && chars <= 90) return 68;
  if (chars <= 110) return 56;
  return 46;
}

export function innerHeadlinePx(headline: string): number {
  const chars = headline.trim().length;
  if (chars <= 32) return 64;
  if (chars <= 58) return 52;
  if (chars <= 84) return 44;
  return 36;
}

export function bodyPx(body: string): number {
  const chars = Math.max(body.trim().length, 1);
  const width = 860;
  const lineHeight = 1.48;
  const maxHeight = 0.55 * 1350;
  for (let size = 72; size >= 30; size -= 2) {
    const charsPerLine = Math.max(12, Math.floor(width / (size * 0.5)));
    const lines = Math.ceil(chars / charsPerLine);
    if (lines * size * lineHeight <= maxHeight) {
      return size;
    }
  }
  return 30;
}

export function pageCounter(index: number, total: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(index + 1)} / ${pad(total)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logoMark(logoDataUrl: string | null | undefined, initial: string, accent: string, height: number): string {
  const safe = safePhotoDataUrl(logoDataUrl ?? null);
  if (safe) {
    const pad = Math.max(10, Math.round(height * 0.18));
    const boxW = Math.round(height * 1.85);
    const innerW = boxW - pad * 2;
    const innerH = height - pad * 2;
    return `<div style="width:${boxW}px;height:${height}px;background:${COVER_NAVY};border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;"><img src="${escapeHtml(safe)}" alt="" style="width:${innerW}px;height:${innerH}px;object-fit:contain;display:block;" /></div>`;
  }
  const letter = escapeHtml((initial.trim() || "A").slice(0, 1).toUpperCase());
  const ink = onAccentText(accent, COVER_NAVY);
  return `<div style="width:${height}px;height:${height}px;border-radius:16px;background:${accent};color:${ink};font-family:Jakarta,Inter,sans-serif;font-weight:800;font-size:${Math.round(height * 0.46)}px;display:flex;align-items:center;justify-content:center;">${letter}</div>`;
}

function sparkle(size: number, accent: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true" style="display:block;"><path fill="${accent}" d="M24 0 L28.2 18.2 L48 24 L28.2 29.8 L24 48 L19.8 29.8 L0 24 L19.8 18.2 Z"/></svg>`;
}

function decorations(accent: string): string {
  return `
    <div style="position:absolute;right:-90px;top:36px;width:540px;height:540px;border:14px solid ${accent};border-radius:50%;"></div>
    <div style="position:absolute;right:150px;top:70px;">${sparkle(54, accent)}</div>
    <div style="position:absolute;right:78px;top:210px;">${sparkle(28, accent)}</div>
    <div style="position:absolute;left:36px;bottom:40px;width:180px;height:130px;background-image:radial-gradient(${accent} 1.7px, transparent 1.8px);background-size:11px 11px;"></div>`;
}

function photoCredit(sourceName: string): string {
  return `<div style="position:absolute;right:16px;top:28px;bottom:28px;z-index:4;writing-mode:vertical-rl;transform:rotate(180deg);color:#FFFFFF;font-family:Inter,sans-serif;font-size:18px;font-weight:500;letter-spacing:0.14em;text-shadow:0 1px 2px rgba(0,0,0,0.55);">Foto: ${escapeHtml(sourceName)}</div>`;
}

function photoPanel(input: BeritaProInput, accent: string): string {
  const photo = safePhotoDataUrl(input.photoDataUrl);
  const art = photo
    ? `<img src="${escapeHtml(photo)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center ${input.focalY}%;filter:grayscale(1) contrast(1.65) brightness(1.45);" />
       <div style="position:absolute;inset:0;background:#2a3c56;mix-blend-mode:multiply;opacity:0.62;"></div>
       <div style="position:absolute;inset:0;background:#e4ebf2;mix-blend-mode:screen;opacity:0.42;"></div>
       ${photoCredit(input.sourceName)}`
    : `<div style="position:absolute;inset:0;background:${COVER_NAVY};"></div>
       <div style="position:absolute;inset:0;background-image:radial-gradient(${accent} 1.5px, transparent 1.7px);background-size:16px 16px;opacity:0.55;"></div>
       <div style="position:absolute;left:48px;right:180px;bottom:56px;font-family:Jakarta,Inter,sans-serif;font-weight:800;font-size:78px;line-height:0.92;letter-spacing:-0.04em;color:${accent};overflow:hidden;max-height:180px;">${escapeHtml(input.slide.kicker || input.sourceName)}</div>`;
  return `<div style="position:absolute;left:0;right:0;bottom:0;height:810px;overflow:hidden;">
    ${art}
    <div style="position:absolute;left:0;right:0;top:0;height:160px;background:linear-gradient(${COVER_NAVY}, transparent);z-index:2;"></div>
    <div style="position:absolute;inset:0;z-index:3;pointer-events:none;">${decorations(accent)}</div>
  </div>`;
}

function swipePill(accent: string, filled: boolean): string {
  const ink = onAccentText(accent, COVER_NAVY);
  const style = filled
    ? `background:${accent};color:${ink};border:3px solid ${accent};`
    : `background:${PAPER};color:${contrastRatio(accent, PAPER) >= 4.5 ? accent : COVER_NAVY};border:3px solid ${accent};`;
  return `<div style="display:inline-flex;align-items:center;${style}border-radius:999px;padding:12px 26px;font-family:Jakarta,Inter,sans-serif;font-weight:700;font-size:22px;letter-spacing:0.12em;">GESER →</div>`;
}

function renderCover(input: BeritaProInput, accent: string): string {
  const px = coverHeadlinePx(input.slide.headline);
  return `
    <div style="position:relative;z-index:4;padding:48px 72px 0;max-height:520px;overflow:hidden;box-sizing:border-box;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;min-height:96px;">
        <div style="font-family:Inter,sans-serif;font-weight:700;font-size:22px;letter-spacing:0.16em;text-transform:uppercase;color:#FFFFFF;padding-top:18px;overflow:hidden;max-width:520px;white-space:nowrap;">${escapeHtml(input.slide.kicker)}</div>
        ${logoMark(input.logoDataUrl, input.initial ?? "A", accent, 92)}
      </div>
      <div style="margin-top:28px;font-family:Jakarta,Inter,sans-serif;font-weight:800;font-size:${px}px;line-height:0.98;letter-spacing:-0.035em;color:#FFFFFF;max-height:300px;overflow:hidden;">${escapeHtml(input.slide.headline)}</div>
      <div style="margin-top:32px;">${swipePill(accent, true)}</div>
    </div>
    ${photoPanel(input, accent)}`;
}

function renderInner(input: BeritaProInput, accent: string): string {
  const last = input.index === input.total - 1;
  const headlineSize = innerHeadlinePx(input.slide.headline);
  const bodySize = bodyPx(input.slide.body);
  const handle = input.handle.trim();
  const cta = last
    ? `<div style="margin-top:14px;font-family:Jakarta,Inter,sans-serif;font-weight:700;font-size:28px;line-height:1.25;color:${COVER_NAVY};">Baca selengkapnya di link bio</div>${
        handle
          ? `<div style="margin-top:8px;font-family:Inter,sans-serif;font-size:24px;color:${COVER_NAVY};">Ikuti @${escapeHtml(handle)}</div>`
          : ""
      }`
    : "";
  const pill = last
    ? ""
    : `<div style="position:absolute;right:56px;bottom:52px;z-index:4;">${swipePill(accent, false)}</div>`;
  return `
    <div style="position:relative;z-index:2;height:100%;padding:56px 72px 230px;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
        <div style="font-family:Inter,sans-serif;font-weight:700;font-size:22px;letter-spacing:0.16em;text-transform:uppercase;color:${COVER_NAVY};padding-top:16px;overflow:hidden;max-width:460px;white-space:nowrap;">${escapeHtml(input.slide.kicker)}</div>
        <div style="display:flex;align-items:center;gap:18px;">
          <div style="font-family:Inter,sans-serif;font-weight:700;font-size:22px;letter-spacing:0.08em;color:${COVER_NAVY};">${pageCounter(input.index, input.total)}</div>
          ${logoMark(input.logoDataUrl, input.initial ?? "A", accent, 78)}
        </div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0;overflow:hidden;">
        <div style="font-family:Jakarta,Inter,sans-serif;font-weight:800;font-size:${headlineSize}px;line-height:1.05;letter-spacing:-0.03em;color:${COVER_NAVY};max-height:220px;overflow:hidden;">${escapeHtml(input.slide.headline)}</div>
        <div style="width:84px;height:8px;background:${accent};margin:28px 0 28px;flex:0 0 auto;"></div>
        <div style="font-family:Inter,sans-serif;font-weight:400;font-size:${bodySize}px;line-height:1.48;color:${COVER_NAVY};max-width:860px;max-height:742px;overflow:hidden;">${escapeHtml(input.slide.body)}</div>
      </div>
    </div>
    <div style="position:absolute;left:72px;bottom:64px;right:300px;z-index:4;">
      <div style="font-family:Inter,sans-serif;font-size:22px;color:${SLATE};">Sumber: ${escapeHtml(input.sourceName)}</div>
      ${cta}
    </div>
    <div style="position:absolute;right:28px;bottom:18px;z-index:1;font-family:Jakarta,Inter,sans-serif;font-weight:800;font-size:228px;line-height:0.8;letter-spacing:-0.05em;color:${accent};">${String(input.index + 1).padStart(2, "0")}</div>
    ${pill}`;
}

export function renderBeritaProHtml(input: BeritaProInput): string {
  const accent = safeAccent(input.accent);
  const slide = { ...input.slide, body: stripTrailingSource(input.slide.body, input.sourceName) };
  input = { ...input, slide };
  const cover = input.index === 0;
  const background = cover ? COVER_NAVY : PAPER;
  const inner = cover ? renderCover(input, accent) : renderInner(input, accent);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaceCss()}
body{margin:0;padding:0;}
</style></head><body>
<section style="position:relative;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden;background:${background};">
${inner}
</section>
</body></html>`;
}
