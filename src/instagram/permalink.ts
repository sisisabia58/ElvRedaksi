import { openAccessToken } from "../auth/token-cipher";
import type { Sql } from "../db/client";
import { bearerInit, graphUrl, type GraphHost } from "./graph";

export function readPermalink(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const permalink = (body as { permalink?: unknown }).permalink;
  if (typeof permalink !== "string") return null;
  let url: URL;
  try {
    url = new URL(permalink);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "www.instagram.com" && url.hostname !== "instagram.com") return null;
  return url.toString();
}

export async function fetchInstagramPermalink(
  fetchImpl: typeof fetch,
  mediaId: string,
  accessToken: string,
  host: GraphHost,
): Promise<string | null> {
  if (!mediaId || mediaId.startsWith("fake_") || !accessToken) return null;
  try {
    const res = await fetchImpl(graphUrl(mediaId, { fields: "permalink" }, host), bearerInit(accessToken));
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) return null;
    return readPermalink(body);
  } catch {
    return null;
  }
}

export async function backfillDraftPermalink(
  sql: Sql,
  draft: { id: string; status: string; igMediaId: string | null; permalink: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (draft.permalink) return draft.permalink;
  if (draft.status !== "posted" || !draft.igMediaId || draft.igMediaId.startsWith("fake_")) return null;
  const rows = await sql.rows<{ access_token: string | null; api_host: string | null }>(
    "select access_token, api_host from ig_connection where id = 1",
  );
  const token = openAccessToken(rows[0]?.access_token);
  if (!token) return null;
  const host: GraphHost = rows[0]?.api_host === "facebook" ? "facebook" : "instagram";
  const permalink = await fetchInstagramPermalink(fetchImpl, draft.igMediaId, token, host);
  if (!permalink) return null;
  await sql.rows(
    `update drafts set ig_permalink = $1 where id = $2 and (ig_permalink is null or ig_permalink = '')`,
    [permalink, draft.id],
  );
  return permalink;
}
