export const DEFAULT_PUBLIC_BASE_URL = "http://127.0.0.1:43123";

export const LOCAL_PUBLIC_URL_ERROR =
  "URL publik masih mengarah ke komputer ini. Isi alamat https:// yang bisa dijangkau Instagram.";

export const HTTPS_PUBLIC_URL_ERROR =
  "URL publik harus https supaya Instagram bisa mengambil gambar.";

function trimBase(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\/$/, "");
}

/** Stored default (or an empty value) yields to PUBLIC_BASE_URL. A saved custom URL wins. */
export function resolvePublicBaseUrl(stored: string | null | undefined): string {
  const value = trimBase(stored);
  const env = trimBase(process.env.PUBLIC_BASE_URL);
  const placeholder = value === "" || value === DEFAULT_PUBLIC_BASE_URL;
  if (placeholder && env) return env;
  return value || DEFAULT_PUBLIC_BASE_URL;
}

export function isLocalPublicUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Indonesian reason to refuse a live publish, or null when Instagram can fetch the images. */
export function publicUrlPublishError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "URL publik tidak valid.";
  }
  if (isLocalPublicUrl(raw)) return LOCAL_PUBLIC_URL_ERROR;
  if (url.protocol !== "https:") return HTTPS_PUBLIC_URL_ERROR;
  return null;
}
