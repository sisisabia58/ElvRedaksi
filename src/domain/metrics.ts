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

export function relativeId(from: Date, now: Date): string {
  const diffMs = now.getTime() - from.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return "baru saja";
  }
  if (minutes < 60) {
    return `${minutes} mnt lalu`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} jam lalu`;
  }
  const days = Math.floor(hours / 24);
  return `${days} hari lalu`;
}
