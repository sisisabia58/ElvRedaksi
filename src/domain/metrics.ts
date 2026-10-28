export function engagementRate(row: {
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
}): number {
  if (row.views <= 0) return 0;
  return ((row.likes + row.comments + row.saves + row.shares) / row.views) * 100;
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(3)}`;
}
