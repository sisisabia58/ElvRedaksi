import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "src/render/fonts");

const FACES: { file: string; family: string; weight: number }[] = [
  { file: "plus-jakarta-sans-latin-800-normal.woff2", family: "Jakarta", weight: 800 },
  { file: "plus-jakarta-sans-latin-700-normal.woff2", family: "Jakarta", weight: 700 },
  { file: "plus-jakarta-sans-latin-500-normal.woff2", family: "Jakarta", weight: 500 },
  { file: "inter-latin-700-normal.woff2", family: "Inter", weight: 700 },
  { file: "inter-latin-400-normal.woff2", family: "Inter", weight: 400 },
];

let cached: string | null = null;

export function fontFaceCss(): string {
  if (cached) {
    return cached;
  }
  cached = FACES.map(({ file, family, weight }) => {
    const data = readFileSync(join(DIR, file)).toString("base64");
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  }).join("");
  return cached;
}
