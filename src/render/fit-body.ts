const BODY_WIDTH = 860;
// Slightly wider than the old 0.5em guess, and counted per word, so a line
// the renderer will wrap is not treated as if it still fits.
const BODY_CHAR_RATIO = 0.52;
const BODY_MAX_LINES = 6;
const PREFERRED_SIZES = [48, 46, 44, 42, 40, 38, 36, 34, 32];
const EMERGENCY_FLOOR = 22;

function charsPerLine(size: number): number {
  return Math.max(8, Math.floor(BODY_WIDTH / (size * BODY_CHAR_RATIO)));
}

export function bodyLineCount(text: string, size: number): number {
  const limit = charsPerLine(size);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 0;
  }
  let lines = 1;
  let column = 0;
  for (const word of words) {
    if (word.length > limit) {
      return BODY_MAX_LINES + 1;
    }
    const gap = column > 0 ? 1 : 0;
    if (column > 0 && column + gap + word.length > limit) {
      lines += 1;
      column = word.length;
    } else {
      column += gap + word.length;
    }
  }
  return lines;
}

function splitSentences(text: string): string[] {
  const masked = text.replace(/(\d)\.(\d)/g, "$1\u0000$2");
  const parts = masked.match(/[^.!?…]+[.!?…]+(?:\s+|$)|[^.!?…]+$/g) ?? [masked];
  return parts
    .map((part) => part.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
}

function sizeThatFits(text: string, sizes: number[]): number | null {
  for (const size of sizes) {
    if (bodyLineCount(text, size) <= BODY_MAX_LINES) {
      return size;
    }
  }
  return null;
}

/** Shrink within 48–32px, then drop whole sentences. Never split a word or a sentence. */
export function fitSlideBody(body: string): { text: string; size: number } {
  const original = body.trim().replace(/\s+/g, " ");
  if (!original) {
    return { text: "", size: PREFERRED_SIZES[0] };
  }

  const full = sizeThatFits(original, PREFERRED_SIZES);
  if (full != null) {
    return { text: original, size: full };
  }

  const sentences = splitSentences(original);
  for (let count = sentences.length - 1; count >= 1; count -= 1) {
    const candidate = sentences.slice(0, count).join(" ");
    const size = sizeThatFits(candidate, PREFERRED_SIZES);
    if (size != null) {
      return { text: candidate, size };
    }
  }

  const first = sentences[0] ?? original;
  const emergency: number[] = [];
  for (let size = PREFERRED_SIZES[PREFERRED_SIZES.length - 1] - 2; size >= EMERGENCY_FLOOR; size -= 2) {
    emergency.push(size);
  }
  const shrunk = sizeThatFits(first, emergency);
  if (shrunk != null) {
    return { text: first, size: shrunk };
  }
  return { text: first, size: EMERGENCY_FLOOR };
}

export function slideBodyCharBudget(): number {
  return charsPerLine(44) * (BODY_MAX_LINES - 1);
}
