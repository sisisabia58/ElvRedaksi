import { FACEBOOK_GRAPH_BASE, FACEBOOK_GRAPH_VERSION, GRAPH_BASE, GRAPH_VERSION } from "../domain/constants";

export type GraphHost = "instagram" | "facebook";

export function graphOrigin(host?: GraphHost | null): string {
  return host === "facebook" ? FACEBOOK_GRAPH_BASE : GRAPH_BASE;
}

export function graphVersion(host?: GraphHost | null): string {
  return host === "facebook" ? FACEBOOK_GRAPH_VERSION : GRAPH_VERSION;
}

/** Graph URL with query fields only. The access token belongs in Authorization, never the query string. */
export function graphUrl(path: string, query?: Record<string, string>, host?: GraphHost | null): string {
  const url = new URL(`${graphOrigin(host)}/${graphVersion(host)}/${path.replace(/^\//, "")}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (key === "access_token") continue;
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function refreshAccessTokenUrl(): string {
  const url = new URL(`${GRAPH_BASE}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  return url.toString();
}

export function bearerInit(accessToken: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return { ...init, headers };
}
