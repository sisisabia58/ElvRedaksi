const PRIVATE_FETCH_MESSAGE = "URL tidak boleh menunjuk ke localhost atau jaringan pribadi.";

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

function isPrivateOrLocalIpv4(host: string): boolean {
  const n = parseIpv4(host);
  if (n === null) {
    return false;
  }
  if ((n & 0xff000000) === 0x7f000000) {
    return true;
  }
  if ((n & 0xff000000) === 0x0a000000) {
    return true;
  }
  if ((n & 0xfff00000) === 0xac100000) {
    return true;
  }
  if ((n & 0xffff0000) === 0xc0a80000) {
    return true;
  }
  if ((n & 0xffff0000) === 0xa9fe0000) {
    return true;
  }
  return false;
}

function expandIpv6(host: string): string[] | null {
  const lower = host.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(lower)) {
    return null;
  }
  if (lower.includes(".")) {
    return null;
  }
  const [head, tail] = lower.split("::");
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

function isPrivateOrLocalIpv6(host: string): boolean {
  const parts = expandIpv6(host);
  if (!parts || parts.length !== 8) {
    return false;
  }
  if (parts.every((part, index) => part === "0" || (index === 7 && part === "1"))) {
    const allZero = parts.slice(0, 7).every((part) => part === "0");
    if (allZero && (parts[7] === "1" || parts[7] === "0001")) {
      return true;
    }
  }
  if (parts[0]?.startsWith("fe8") || parts[0]?.startsWith("fe9") || parts[0]?.startsWith("fea") || parts[0]?.startsWith("feb")) {
    return true;
  }
  return false;
}

export function isBlockedFetchTarget(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost") {
    return true;
  }
  if (isPrivateOrLocalIpv4(host)) {
    return true;
  }
  if (host.includes(":") && isPrivateOrLocalIpv6(host)) {
    return true;
  }
  return false;
}

export function assertPublicFetchUrl(url: string): void {
  if (isBlockedFetchTarget(url)) {
    throw new Error(PRIVATE_FETCH_MESSAGE);
  }
}

export { PRIVATE_FETCH_MESSAGE };
