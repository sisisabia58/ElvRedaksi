import type { Slide } from "../agents/copywriter";
import { clampSlideCount, type SlideTemplateName } from "../domain/brand";

export type SlideFormatOptions = {
  template?: SlideTemplateName;
  slideCount?: number;
};

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
