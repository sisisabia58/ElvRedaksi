export function demoRewriteSummary(input: { demoScores: number; done: number; total: number }): {
  score: string;
  queue: string | null;
} {
  const score = `${input.demoScores} draf masih skor demo.`;
  if (input.total <= 0) {
    return { score, queue: null };
  }
  const copyLeft = Math.max(input.total - input.done, 0);
  return {
    score,
    queue: `${copyLeft} draf masih naskah demo. ${input.done} dari ${input.total} tulis ulang selesai.`,
  };
}
