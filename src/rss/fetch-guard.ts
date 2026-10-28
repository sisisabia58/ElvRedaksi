import { lookup as dnsLookupPromises } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const PRIVATE_FETCH_MESSAGE = "URL tidak boleh menunjuk ke localhost atau jaringan pribadi.";
export const MAX_FETCH_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

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

function normalizeIpv6Host(host: string): string {
  const h = stripBrackets(host).toLowerCase();
  const v4tail = h.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (!v4tail) {
    return h;
  }
  const n = parseIpv4(v4tail[2] ?? "");
  if (n === null) {
    return h;
  }
  const hi = ((n >>> 16) & 0xffff).toString(16);
  const lo = (n & 0xffff).toString(16);
  return `${v4tail[1]}${hi}:${lo}`;
}

function expandIpv6(host: string): string[] | null {
  const lower = normalizeIpv6Host(host);
  if (!/^[0-9a-f:]+$/.test(lower)) {
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

function ipv4FromMappedIpv6(host: string): string | null {
  const parts = expandIpv6(host);
  if (!parts || parts.length !== 8) {
    return null;
  }
  const vals = parts.map((part) => hextet(part.padStart(4, "0")));
  if (vals.slice(0, 5).some((value) => value !== 0)) {
    return null;
  }
  if (vals[5] !== 0xffff) {
    return null;
  }
  const n = (vals[6] << 16) + vals[7];
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

function isBlockedIpv6Literal(host: string): boolean {
  const mapped = ipv4FromMappedIpv6(host);
  if (mapped && isBlockedIpv4Literal(mapped)) {
    return true;
  }
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
  const results = await dnsLookupPromises(host, { all: true, verbatim: true });
  if (results.length === 0) {
    throw new Error("dns empty");
  }
  return results.map((entry) => entry.address);
}

export async function resolveAllowedFetchAddresses(hostname: string): Promise<string[]> {
  const addresses = await resolveHostAddresses(hostname);
  const allowed = addresses.filter((address) => !isBlockedIpAddress(address));
  if (allowed.length === 0) {
    throw new Error(PRIVATE_FETCH_MESSAGE);
  }
  return allowed;
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
    await resolveAllowedFetchAddresses(parsed.hostname);
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

function createPinnedLookup(hostname: string, addresses: string[]) {
  const expected = stripBrackets(hostname).toLowerCase();
  let cursor = 0;
  return (
    lookupHost: string,
    _options: unknown,
    callback: (err: Error | null, address: string, family: number) => void,
  ) => {
    const host = stripBrackets(lookupHost).toLowerCase();
    if (host !== expected) {
      callback(new Error("unexpected host"), "", 0);
      return;
    }
    const address = addresses[cursor % addresses.length];
    cursor += 1;
    const family = isIP(address) === 6 ? 6 : 4;
    callback(null, address, family);
  };
}

async function readResponseTextLimited(response: Awaited<ReturnType<typeof undiciFetch>>, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }
      const take = Math.min(value.byteLength, maxBytes - total);
      if (take > 0) {
        chunks.push(value.subarray(0, take));
        total += take;
      }
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function fetchPinnedUrl(url: string, timeoutMs: number): Promise<Response> {
  const parsed = new URL(url);
  const addresses = await resolveAllowedFetchAddresses(parsed.hostname);
  const dispatcher = new Agent({
    connect: {
      lookup: createPinnedLookup(parsed.hostname, addresses),
    },
  });
  return undiciFetch(url, {
    dispatcher,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  });
}

export async function fetchPublicText(url: string, timeoutMs: number): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicFetchUrl(current);
    const response = await fetchPinnedUrl(current, timeoutMs);
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
    return readResponseTextLimited(response, MAX_FETCH_BYTES);
  }
  throw new Error("Terlalu banyak redirect");
}

export { PRIVATE_FETCH_MESSAGE };
