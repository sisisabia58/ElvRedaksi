import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOGO_PATH = join(process.cwd(), "src/render/brand/analyst-digest-logo.jpg");

let cachedDataUrl: string | null = null;

export function readDefaultLogo(): { bytes: Buffer; contentType: string } {
  return { bytes: readFileSync(LOGO_PATH), contentType: "image/jpeg" };
}

export function defaultLogoDataUrl(): string | null {
  if (cachedDataUrl) {
    return cachedDataUrl;
  }
  try {
    const { bytes, contentType } = readDefaultLogo();
    cachedDataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
    return cachedDataUrl;
  } catch {
    return null;
  }
}
