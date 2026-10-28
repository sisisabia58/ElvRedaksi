import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_FETCH_MESSAGE = "URL tidak boleh menunjuk ke localhost atau jaringan pribadi.";

function stripBrackets(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseIpv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function isBlockedIpv4Literal(host: string): boolean {
  const n = parseIpv4(host);
  if (n === null) {
    return false;
  }
  if (n === 0) {
    return true;
  }
  if (n >= 0x7f000000 && n <= 0x7fffffff) {
    return true;
  }
  if (n >= 0x0a000000 && n <= 0x0affffff) {
    return true;
  }
  if (n >= 0xac100000 && n <= 0xac1fffff) {
    return true;
  }
  if (n >= 0xc0a80000 && n <= 0xc0a8ffff) {
    return true;
  }
  if (n >= 0xa9fe0000 && n <= 0xa9feffff) {
    return true;
  }
  return false;
}

function expandIpv6(host: string): string[] | null {
  const lower = stripBrackets(host).toLowerCase();
  if (!/^[0-9a-f:]+$/.test(lower)) {
    return null;
  }
  if (lower.includes(".")) {
    return null;
  }
  const [head, tail] = lower.split("::");
  if (lower.split("::").length > 2) {
    return null;
  }
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  if (headParts.length + tailParts.length > 7) {
    return null;
  }
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) {
    return null;
  }
  return [...headParts, ...Array(missing).fill("0"), ...tailParts];
}

function hextet(value: string): number {
  return Number.parseInt(value, 16);
}

function isBlockedIpv6Literal(host: string): boolean {
  const parts = expandIpv6(host);
  if (!parts || parts.length !== 8) {
    return false;
  }
  const allZero = parts.slice(0, 7).every((part) => part === "0" || part === "0000");
  const last = hextet(parts[7] ?? "0");
  if (allZero && last === 1) {
    return true;
  }
  const first = hextet(parts[0] ?? "0");
  if ((first & 0xfe00) === 0xfc00) {
    return true;
  }
  if ((first & 0xffc0) === 0xfe80) {
    return true;
  }
  return false;
}

function isBlockedIpAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    return isBlockedIpv4Literal(address);
  }
  if (kind === 6) {
    return isBlockedIpv6Literal(address);
  }
  return true;
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  const host = stripBrackets(hostname).toLowerCase();
  if (host === "localhost") {
    return ["127.0.0.1"];
  }
  const literalKind = isIP(host);
  if (literalKind === 4 || literalKind === 6) {
    return [host];
  }
  const results = await lookup(host, { all: true, verbatim: true });
  if (results.length === 0) {
    throw new Error("dns empty");
  }
  return results.map((entry) => entry.address);
}

export async function isBlockedFetchTarget(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return true;
  }
  try {
    const addresses = await resolveHostAddresses(parsed.hostname);
    for (const address of addresses) {
      if (isBlockedIpAddress(address)) {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

export async function assertPublicFetchUrl(url: string): Promise<void> {
  if (await isBlockedFetchTarget(url)) {
    throw new Error(PRIVATE_FETCH_MESSAGE);
  }
}

const MAX_REDIRECTS = 5;

export async function fetchPublicText(url: string, timeoutMs: number): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicFetchUrl(current);
    const response = await fetch(current, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect tanpa lokasi");
      }
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  }
  throw new Error("Terlalu banyak redirect");
}

export { PRIVATE_FETCH_MESSAGE };
