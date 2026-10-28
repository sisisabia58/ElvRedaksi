export const DRAFT_STATUSES = [
  "drafted",
  "needs_review",
  "approved",
  "scheduled",
  "posting",
  "posted",
  "failed",
  "rejected",
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export type ActorKind = "human" | "worker";

const EDGES: Record<DraftStatus, DraftStatus[]> = {
  drafted: ["needs_review"],
  needs_review: ["approved", "scheduled", "rejected", "posted"],
  approved: ["scheduled", "posting", "rejected", "posted", "needs_review"],
  scheduled: ["posting", "needs_review", "rejected", "posted"],
  posting: ["posted", "failed"],
  posted: [],
  failed: ["posting", "needs_review"],
  rejected: ["needs_review"],
};

const WORKER_ALLOW = new Set([
  "drafted>needs_review",
  "scheduled>posting",
  "posting>posted",
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
