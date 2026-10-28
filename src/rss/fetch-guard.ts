import { lookup as dnsLookupPromises } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const PRIVATE_FETCH_MESSAGE = "URL tidak boleh menunjuk ke localhost atau jaringan pribadi.";
export const DNS_FETCH_MESSAGE = "Gagal menyelesaikan hostname.";
export const FETCH_BODY_TOO_LARGE_MESSAGE = "Response terlalu besar.";
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

function ipv4Dotted(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

function isBlockedIpv4Literal(host: string): boolean {
  const n = parseIpv4(host);
  if (n === null) {
    return false;
  }
  if ((n >>> 24) === 0) {
    return true;
  }
  if (n >= 0x7f000000 && n <= 0x7fffffff) {
    return true;
  }
  if (n >= 0x0a000000 && n <= 0x0affffff) {
    return true;
  }
  if (n >= 0x64400000 && n <= 0x647fffff) {
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
  if (n >= 0xe0000000 && n <= 0xefffffff) {
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
  if (!lower.includes("::")) {
    const full = lower.split(":").filter(Boolean);
    if (full.length === 8) {
      return full;
    }
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
  if (vals[5] === 0xffff) {
    const n = (vals[6] << 16) + vals[7];
    return ipv4Dotted(n >>> 0);
  }
  if (vals[4] === 0xffff && vals[5] === 0) {
    const n = (vals[6] << 16) + vals[7];
    return ipv4Dotted(n >>> 0);
  }
  return null;
}

function ipv4FromCompatEmbedded(host: string): string | null {
  const parts = expandIpv6(host);
  if (!parts || parts.length !== 8) {
    return null;
  }
  const vals = parts.map((part) => hextet(part.padStart(4, "0")));
  if (vals[5] === 0xffff) {
    return null;
  }
  if (vals.slice(0, 6).some((value) => value !== 0)) {
    return null;
  }
  const n = (vals[6] << 16) + vals[7];
  return ipv4Dotted(n >>> 0);
}

function ipv4FromTeredo(host: string): string | null {
  const parts = expandIpv6(host);
  if (!parts || parts.length !== 8) {
    return null;
  }
  const vals = parts.map((part) => hextet(part.padStart(4, "0")));
  if (vals[0] !== 0x2001 || vals[1] !== 0) {
    return null;
  }
  const n = (vals[6] << 16) + vals[7];
  return ipv4Dotted(n >>> 0);
}

function ipv4From6to4(host: string): string | null {
  const parts = expandIpv6(host);
  if (!parts || parts.length !== 8) {
    return null;
  }
  const vals = parts.map((part) => hextet(part.padStart(4, "0")));
  if (vals[0] !== 0x2002) {
    return null;
  }
  const n = (vals[1] << 16) + vals[2];
  return ipv4Dotted(n >>> 0);
}

function ipv4FromNat64(host: string): string | null {
  const parts = expandIpv6(host);
  if (!parts || parts.length !== 8) {
    return null;
  }
  const vals = parts.map((part) => hextet(part.padStart(4, "0")));
  if (vals[0] !== 0x64 || vals[1] !== 0xff9b) {
    return null;
  }
  const n = (vals[6] << 16) + vals[7];
  return ipv4Dotted(n >>> 0);
}

function isBlockedIpv6Literal(host: string): boolean {
  const stripped = stripBrackets(host);
  for (const decode of [
    ipv4FromMappedIpv6,
    ipv4FromCompatEmbedded,
    ipv4From6to4,
    ipv4FromNat64,
    ipv4FromTeredo,
  ]) {
    const embedded = decode(host);
    if (embedded && isBlockedIpv4Literal(embedded)) {
      return true;
    }
  }
  const parts = expandIpv6(host);
  if (!parts || parts.length !== 8) {
    return isIP(stripped) === 6;
  }
  const vals = parts.map((part) => hextet(part.padStart(4, "0")));
  if (vals.every((value) => value === 0)) {
    return true;
  }
  const allZero = vals.slice(0, 7).every((value) => value === 0);
  if (allZero && vals[7] === 1) {
    return true;
  }
  const first = vals[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) {
    return true;
  }
  if ((first & 0xffc0) === 0xfe80) {
    return true;
  }
  if ((first & 0xff00) === 0xff00) {
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

async function resolveHostAddresses(hostname: string, timeoutMs: number): Promise<string[]> {
  if (timeoutMs <= 0) {
    throw new Error(DNS_FETCH_MESSAGE);
  }
  const host = stripBrackets(hostname).toLowerCase();
  if (host === "localhost") {
    return ["127.0.0.1"];
  }
  const literalKind = isIP(host);
  if (literalKind === 4 || literalKind === 6) {
    return [host];
  }
  const lookup = dnsLookupPromises(host, { all: true, verbatim: true }).then((results) => {
    if (results.length === 0) {
      throw new Error(DNS_FETCH_MESSAGE);
    }
    return results.map((entry) => entry.address);
  });
  const timedOut = new Promise<string[]>((_, reject) => {
    setTimeout(() => reject(new Error(DNS_FETCH_MESSAGE)), timeoutMs);
  });
  return Promise.race([lookup, timedOut]);
}

export async function resolveAllowedFetchAddresses(
  hostname: string,
  timeoutMs = 8000,
): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = await resolveHostAddresses(hostname, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.message === DNS_FETCH_MESSAGE) {
      throw error;
    }
    throw new Error(DNS_FETCH_MESSAGE);
  }
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

export async function assertPublicFetchUrl(url: string, timeoutMs = 8000): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL tidak valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL tidak valid.");
  }
  try {
    await resolveAllowedFetchAddresses(parsed.hostname, timeoutMs);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(DNS_FETCH_MESSAGE);
  }
}

export function createPinnedLookup(hostname: string, addresses: string[]) {
  const expected = stripBrackets(hostname).toLowerCase();
  let cursor = 0;
  return (
    lookupHost: string,
    options: { all?: boolean },
    callback: (
      err: Error | null,
      address?: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ) => {
    const host = stripBrackets(lookupHost).toLowerCase();
    if (host !== expected) {
      callback(new Error("unexpected host"));
      return;
    }
    const entries = addresses.map((address) => ({
      address,
      family: isIP(address) === 6 ? 6 : 4,
    }));
    if (options?.all) {
      callback(null, entries);
      return;
    }
    const address = addresses[cursor % addresses.length];
    cursor += 1;
    const family = isIP(address) === 6 ? 6 : 4;
    callback(null, address, family);
  };
}

async function readResponseTextLimited(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
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
        truncated = value.byteLength > take || !done;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (truncated) {
    throw new Error(FETCH_BODY_TOO_LARGE_MESSAGE);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function fetchPinnedUrl(
  url: string,
  signal: AbortSignal,
  hostname: string,
  addresses: string[],
): Promise<{ response: Awaited<ReturnType<typeof undiciFetch>>; close: () => Promise<void> }> {
  const dispatcher = new Agent({
    connect: {
      lookup: createPinnedLookup(hostname, addresses),
    },
  });
  try {
    const response = await undiciFetch(url, {
      dispatcher,
      signal,
      redirect: "manual",
    });
    return {
      response,
      close: () => dispatcher.close(),
    };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}

export async function fetchPublicText(url: string, timeoutMs: number): Promise<string> {
  const deadlineAt = Date.now() + timeoutMs;
  const abortSignal = AbortSignal.timeout(timeoutMs);
  const remainingMs = () => {
    const left = deadlineAt - Date.now();
    if (left <= 0) {
      throw new Error(DNS_FETCH_MESSAGE);
    }
    return left;
  };

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error("URL tidak valid.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("URL tidak valid.");
    }
    const addresses = await resolveAllowedFetchAddresses(parsed.hostname, remainingMs());
    const { response, close } = await fetchPinnedUrl(current, abortSignal, parsed.hostname, addresses);
    try {
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
      return await readResponseTextLimited(response, MAX_FETCH_BYTES);
    } finally {
      await close();
    }
  }
  throw new Error("Terlalu banyak redirect");
}

export { PRIVATE_FETCH_MESSAGE };
