const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeShortCode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < 5; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}
