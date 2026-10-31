export const DRAFT_STATUSES = [
  "drafted",
  "needs_review",
  "approved",
  "scheduled",
  "posting",
  "posted",
  "simulasi",
  "failed",
  "rejected",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

const STATUS_LABELS: Record<DraftStatus, string> = {
  drafted: "Draf",
  needs_review: "Perlu review",
  approved: "Disetujui",
  scheduled: "Terjadwal",
  posting: "Sedang diposting",
  posted: "Sudah diposting",
  simulasi: "Simulasi",
  failed: "Gagal posting",
  rejected: "Ditolak",
};

export function draftStatusLabel(status: DraftStatus): string {
  return STATUS_LABELS[status];
}
export type ActorKind = "human" | "worker";

const EDGES: Record<DraftStatus, DraftStatus[]> = {
  drafted: ["needs_review"],
  needs_review: ["approved", "scheduled", "rejected", "posted"],
  approved: ["scheduled", "posting", "rejected", "posted", "needs_review"],
  scheduled: ["posting", "needs_review", "rejected", "posted"],
  posting: ["posted", "simulasi", "failed"],
  posted: [],
  simulasi: [],
  failed: ["posting", "needs_review"],
  rejected: ["needs_review"],
};

const WORKER_ALLOW = new Set([
  "drafted>needs_review",
  "scheduled>posting",
  "posting>posted",
  "posting>simulasi",
  "posting>failed",
]);

export function assertTransition(
  actor: ActorKind,
  from: DraftStatus,
  to: DraftStatus,
  manual = false,
): void {
  const key = `${from}>${to}`;
  if (actor === "worker" && !WORKER_ALLOW.has(key)) {
    throw new Error("publish requires human approval");
  }
  if (!EDGES[from].includes(to)) throw new Error(`illegal ${from} -> ${to}`);
  if (to === "posted" && from !== "posting" && !manual) {
    throw new Error("manual flag required");
  }
}

export type ReviewAction =
  | "approve"
  | "schedule"
  | "reject"
  | "post_now"
  | "posted_manual"
  | "retry"
  | "delete";

export function humanTransitionAllowed(from: DraftStatus, to: DraftStatus, manual = false): boolean {
  try {
    assertTransition("human", from, to, manual);
    return true;
  } catch {
    return false;
  }
}

export function reviewActionVisible(status: DraftStatus, action: ReviewAction): boolean {
  switch (action) {
    case "approve":
      return humanTransitionAllowed(status, "approved");
    case "schedule":
      return humanTransitionAllowed(status, "scheduled");
    case "reject":
      return humanTransitionAllowed(status, "rejected");
    case "post_now":
      // postDraftNow steps needs_review → approved → posting; that path is not a direct edge.
      return status === "needs_review" || humanTransitionAllowed(status, "posting");
    case "posted_manual":
      return humanTransitionAllowed(status, "posted", true);
    case "retry":
      return status === "failed";
    case "delete":
      return status !== "posting";
  }
}
