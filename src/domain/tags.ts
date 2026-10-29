export function normalizeCategory(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }
  return trimmed
    .split(" ")
    .map((word) => {
      const letters = word.replace(/[^0-9A-Za-z\u00C0-\u024F]/g, "");
      if (letters.length > 0 && letters.length <= 4 && letters === letters.toLocaleUpperCase("id")) {
        return word;
      }
      const lower = word.toLocaleLowerCase("id");
      return lower.charAt(0).toLocaleUpperCase("id") + lower.slice(1);
    })
    .join(" ");
}

function titleCaseWord(word: string): string {
  const lower = word.toLocaleLowerCase("id");
  return lower.charAt(0).toLocaleUpperCase("id") + lower.slice(1);
}

/** Slide category line. A fully shouted phrase becomes title case; a short acronym such as AI stays. */
export function normalizeKicker(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }
  const letters = trimmed.replace(/[^0-9A-Za-z\u00C0-\u024F]/g, "");
  if (letters.length > 4 && letters === letters.toLocaleUpperCase("id")) {
    return trimmed.split(" ").map(titleCaseWord).join(" ");
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
