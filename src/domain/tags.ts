const KNOWN_ACRONYMS = new Set([
  "UMKM",
  "KKP",
  "KNMP",
  "DPR",
  "BUMN",
  "DPD",
  "KPK",
  "OJK",
  "BPJS",
  "TNI",
  "POLRI",
  "WHO",
  "PBB",
  "ASEAN",
  "IMF",
  "OECD",
  "NKRI",
  "KPU",
  "MK",
  "PLN",
  "BPN",
  "ATR",
]);

function coreLetters(word: string): string {
  return word.replace(/[^0-9A-Za-z\u00C0-\u024F]/g, "");
}

function withCore(word: string, core: string): string {
  const match = word.match(/^([^0-9A-Za-z\u00C0-\u024F]*)([0-9A-Za-z\u00C0-\u024F]+)(.*)$/);
  if (!match) {
    return word;
  }
  return `${match[1]}${core}${match[3]}`;
}

function canonicalWord(word: string): string {
  const letters = coreLetters(word);
  if (!letters) {
    return word;
  }
  const upper = letters.toLocaleUpperCase("id");
  if (KNOWN_ACRONYMS.has(upper)) {
    return withCore(word, upper);
  }
  if (letters.length <= 4 && letters === upper) {
    return word;
  }
  const lower = letters.toLocaleLowerCase("id");
  const titled = lower.charAt(0).toLocaleUpperCase("id") + lower.slice(1);
  return withCore(word, titled);
}

export function normalizeCategory(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }
  return trimmed.split(" ").map(canonicalWord).join(" ");
}

/** Slide category line. A shouted phrase becomes title case; acronyms stay uppercase. */
export function normalizeKicker(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }
  return normalizeCategory(trimmed);
}

export function normalizeCategories(tags: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeCategory(tag);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("id");
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }
  return next;
}
