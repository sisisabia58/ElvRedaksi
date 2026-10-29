import { createHash } from "node:crypto";
import type { Sql } from "../db/client";
import { fetchPublicBytes, MAX_IMAGE_BYTES } from "./fetch-guard";

function normalizeImageType(contentType: string): string | null {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "image/jpg" || type === "image/jpeg") return "image/jpeg";
  if (type === "image/png" || type === "image/webp") return type;
  return null;
}

export function bytesFromDb(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return null;
  }
  return null;
}

export function dataUrlFromBytes(bytes: unknown, contentType: string): string | null {
  const type = normalizeImageType(contentType);
  const buffer = bytesFromDb(bytes);
  if (!type || !buffer || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    return null;
  }
  return `data:${type};base64,${buffer.toString("base64")}`;
}

export async function cachedImageDataUrl(sql: Sql, url: string): Promise<string | null> {
  try {
    const hash = createHash("sha256").update(url).digest("hex");
    const cached = await sql.rows<{ bytes: unknown; content_type: string }>(
      "select bytes, content_type from image_cache where url_hash = $1",
      [hash],
    );
    if (cached[0]) {
      return dataUrlFromBytes(cached[0].bytes, cached[0].content_type);
    }
    const fetched = await fetchPublicBytes(url, 8000, MAX_IMAGE_BYTES);
    const type = normalizeImageType(fetched.contentType);
    if (!type || fetched.bytes.byteLength === 0 || fetched.bytes.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    const buffer = Buffer.from(fetched.bytes);
    await sql.rows(
      `insert into image_cache (url_hash, url, bytes, content_type)
       values ($1, $2, $3, $4)
       on conflict (url_hash) do nothing`,
      [hash, url, buffer, type],
    );
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
