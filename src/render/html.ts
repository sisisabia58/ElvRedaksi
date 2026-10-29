import type { Slide } from "../agents/copywriter";
import { clampSlideCount, type SlideTemplateName } from "../domain/brand";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "../domain/constants";
import { renderBeritaProHtml } from "./berita-pro";

export type SlideTemplate = SlideTemplateName;

export type RenderSlideInput = {
  template: SlideTemplate;
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

export type SlideFormatOptions = {
  template?: SlideTemplate;
  slideCount?: number;
};

const PALETTE = ["#14171c", "#f6ee5f", "#ffffff"] as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

function headlineHash(headline: string): number {
  let h = 2166136261;
  for (let i = 0; i < headline.length; i++) {
    h ^= headline.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function geometricCoverMarkup(headline: string, accent: string): string {
  const hash = headlineHash(headline);
  const colors = [0, 1, 2, 3].map((i) =>
    mixHex(accent, PALETTE[i % PALETTE.length], 0.35 + ((hash >> (i * 3)) & 7) / 20),
  );
  const rects = [0, 1, 2, 3].map((i) => {
    const wobble = (hash >> (i * 5)) & 31;
    const left = i % 2 === 0 ? 0 : 35 + (wobble % 15);
    const top = i < 2 ? 0 : 40 + (wobble % 20);
    const width = 55 + (wobble % 25);
    const height = 45 + ((wobble * 3) % 30);
    return `<div style="position:absolute;left:${left}%;top:${top}%;width:${width}%;height:${height}%;background:${colors[i]};"></div>`;
  });
  return `<div style="position:absolute;inset:0;overflow:hidden;">${rects.join("")}</div>`;
}

const SAFE_DATA_IMAGE =
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function safePhotoDataUrl(photoDataUrl: string | null): string | null {
  if (!photoDataUrl || photoDataUrl.trim() !== photoDataUrl) {
    return null;
  }
  if (/[\s"']/.test(photoDataUrl)) {
    return null;
  }
  if (!SAFE_DATA_IMAGE.test(photoDataUrl)) {
    return null;
  }
  return photoDataUrl;
}

function photoOrGeo(photoDataUrl: string | null, focalY: number, headline: string, accent: string): string {
  const safeSrc = safePhotoDataUrl(photoDataUrl);
  if (safeSrc) {
    return `<img src="${escapeHtml(safeSrc)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center ${focalY}%;" />`;
  }
  return geometricCoverMarkup(headline, accent);
}

function docShell(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:0;}
.headline{font-family:Impact,sans-serif;}
.body{font-family:Georgia,serif;}
</style></head><body>${inner}</body></html>`;
}

function handleSpan(handle: string): string {
  const trimmed = handle.trim();
  return trimmed ? `<span>@${escapeHtml(trimmed)}</span>` : "";
}

function renderStabilo(input: RenderSlideInput): string {
  const { slide, index, total, handle, sourceName, accent } = input;
  const page = `${index + 1}/${total}`;
  return docShell(`
<section style="position:relative;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden;background:${accent};color:#0d0d0d;padding:64px;box-sizing:border-box;display:flex;flex-direction:column;">
  <div style="position:absolute;top:48px;right:64px;font-family:Georgia,serif;font-size:28px;">${page}</div>
  <div class="body" style="font-size:32px;margin-bottom:24px;">${escapeHtml(slide.kicker)}</div>
  <div class="headline" style="font-size:72px;line-height:1.05;flex:1;">${escapeHtml(slide.headline)}</div>
  <div class="body" style="font-size:28px;margin-top:auto;display:flex;justify-content:space-between;">
    <span>Sumber: ${escapeHtml(sourceName)}</span>
    ${handleSpan(handle)}
  </div>
</section>`);
}

function renderSerif(input: RenderSlideInput): string {
  const { slide, sourceName, handle, accent, photoDataUrl, focalY } = input;
  const topH = Math.round(SLIDE_HEIGHT * 0.52);
  const bottomH = SLIDE_HEIGHT - topH;
  return docShell(`
<section style="position:relative;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden;background:#fff;">
  <div style="height:${topH}px;padding:64px 64px 32px;box-sizing:border-box;display:flex;flex-direction:column;">
    <div class="body" style="font-size:30px;color:#333;margin-bottom:16px;">${escapeHtml(slide.kicker)}</div>
    <div class="headline" style="font-size:64px;line-height:1.05;color:#0d0d0d;margin-bottom:24px;">${escapeHtml(slide.headline)}</div>
    <div class="body" style="font-size:28px;color:#333;flex:1;">${escapeHtml(slide.body)}</div>
    <div class="body" style="font-size:26px;color:#555;margin-top:16px;display:flex;justify-content:space-between;">
      <span>Sumber: ${escapeHtml(sourceName)}</span>
      ${handleSpan(handle)}
    </div>
  </div>
  <div style="position:relative;height:${bottomH}px;overflow:hidden;">
    ${photoOrGeo(photoDataUrl, focalY, slide.headline, accent)}
  </div>
</section>`);
}

function renderFotoPenuh(input: RenderSlideInput): string {
  const { slide, sourceName, accent, photoDataUrl, focalY } = input;
  return docShell(`
<section style="position:relative;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden;background:#14171c;">
  ${photoOrGeo(photoDataUrl, focalY, slide.headline, accent)}
  <div style="position:absolute;left:0;right:0;bottom:0;padding:64px 64px 72px;background:linear-gradient(transparent,rgba(0,0,0,0.85));color:#fff;">
    <div class="headline" style="font-size:68px;line-height:1.05;margin-bottom:24px;">${escapeHtml(slide.headline)}</div>
    <div class="body" style="font-size:28px;">Sumber: ${escapeHtml(sourceName)}</div>
  </div>
</section>`);
}

function renderCatatan(input: RenderSlideInput): string {
  const { slide, sourceName } = input;
  return docShell(`
<section style="position:relative;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;overflow:hidden;background:#f4efe4;padding:64px;box-sizing:border-box;display:flex;flex-direction:column;">
  <div style="background:#f6ee5f;padding:32px 40px;margin-bottom:32px;max-width:85%;box-shadow:4px 6px 0 rgba(0,0,0,0.12);">
    <div class="body" style="font-size:32px;color:#0d0d0d;">${escapeHtml(slide.kicker)}</div>
  </div>
  <div class="headline" style="font-size:68px;line-height:1.05;color:#0d0d0d;flex:1;">${escapeHtml(slide.headline)}</div>
  <div class="body" style="font-size:28px;color:#333;margin-top:auto;">Sumber: ${escapeHtml(sourceName)}</div>
</section>`);
}

export function renderSlideHtml(input: RenderSlideInput): string {
  switch (input.template) {
    case "stabilo":
      return renderStabilo(input);
    case "serif":
      return renderSerif(input);
    case "foto_penuh":
      return renderFotoPenuh(input);
    case "catatan":
      return renderCatatan(input);
    case "berita_pro":
      return renderBeritaProHtml(input);
    default:
      return renderSerif(input);
  }
}

export function slidesForFormat(
  format: "carousel_full" | "teaser_bio",
  slides: Slide[],
  options?: SlideFormatOptions,
): Slide[] {
  const cover = slides.find((s) => s.role === "cover");
  if (!cover) {
    throw new Error("slide tidak lengkap");
  }
  const picked =
    options?.template === "berita_pro"
      ? (() => {
          const points = slides
            .filter((slide) => slide.role === "point")
            .slice(0, clampSlideCount(options.slideCount) - 1);
          if (points.length === 0) {
            throw new Error("slide tidak lengkap");
          }
          return [cover, ...points];
        })()
      : format === "teaser_bio"
        ? (() => {
            const cta = slides.find((s) => s.role === "cta");
            if (!cta) {
              throw new Error("slide tidak lengkap");
            }
            return [cover, cta];
          })()
        : [cover, ...slides.filter((s) => s.role === "point")];
  if (picked.length < 2 || picked.length > 10) {
    throw new Error("jumlah slide tidak valid");
  }
  return picked;
}
