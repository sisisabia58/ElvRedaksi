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

const WORKER = new Set(["scheduled>posting", "posting>posted", "posting>failed"]);

export function assertTransition(
  actor: ActorKind,
  from: DraftStatus,
  to: DraftStatus,
  manual = false,
): void {
  if (!EDGES[from].includes(to)) throw new Error(`illegal ${from} -> ${to}`);
  if (to === "posted" && from !== "posting" && !manual) {
    throw new Error("manual flag required");
  }
  if (actor === "worker" && !WORKER.has(`${from}>${to}`)) {
    throw new Error("publish requires human approval");
  }
}
