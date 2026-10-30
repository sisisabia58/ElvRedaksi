export const PLACEHOLDER_BODY = "Satu kalimat pembuka.";

export function draftAwaitsRewrite(slides: Array<{ body?: string }>): boolean {
  return slides.some((slide) => typeof slide.body === "string" && slide.body.includes(PLACEHOLDER_BODY));
}
