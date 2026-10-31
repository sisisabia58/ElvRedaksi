import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

let warnedPlain = false;
let warnedLocked = false;

function keyBytes(): Buffer | null {
  const secret =
    (process.env.TOKEN_ENCRYPTION_KEY ?? "").trim() || (process.env.CRON_SECRET ?? "").trim();
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

function warnPlain(): void {
  if (warnedPlain) return;
  warnedPlain = true;
  console.warn(
    "Token Instagram disimpan tanpa enkripsi. Set TOKEN_ENCRYPTION_KEY atau CRON_SECRET.",
  );
}

function warnLocked(): void {
  if (warnedLocked) return;
  warnedLocked = true;
  console.warn(
    "Token Instagram terenkripsi tetapi kunci tidak ada. Set TOKEN_ENCRYPTION_KEY atau CRON_SECRET.",
  );
}

/** AES-GCM when a server secret exists. Otherwise the token is stored unchanged and a warning is logged once. */
export function sealAccessToken(token: string): string {
  const key = keyBytes();
  if (!key) {
    warnPlain();
    return token;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Legacy rows without the prefix are returned as stored. A locked ciphertext becomes an empty string. */
export function openAccessToken(stored: string | null | undefined): string {
  const value = (stored ?? "").trim();
  if (!value) return "";
  if (!value.startsWith(PREFIX)) return value;
  const key = keyBytes();
  if (!key) {
    warnLocked();
    return "";
  }
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function isSealedAccessToken(stored: string | null | undefined): boolean {
  return (stored ?? "").trim().startsWith(PREFIX);
}
