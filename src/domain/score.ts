export type AspectScores = {
  relevansi: number;
  emosi: number;
  kebaruan: number;
  timing: number;
  shareability: number;
};

const KEYS = ["relevansi", "emosi", "kebaruan", "timing", "shareability"] as const;

export function totalScore(aspects: AspectScores): number {
  let sum = 0;
  for (const key of KEYS) {
    const n = aspects[key];
    if (!Number.isInteger(n) || n < 0 || n > 20) throw new Error(`${key} must be an integer 0-20`);
    sum += n;
  }
  return sum;
}

export function verdict(score: number, threshold: number): "lolos" | "dilewati" {
  return score >= threshold ? "lolos" : "dilewati";
}
