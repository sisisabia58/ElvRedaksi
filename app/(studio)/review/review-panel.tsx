"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reviewActionVisible, type DraftStatus } from "@/src/domain/status";
import { RegenerateDemoButton } from "@/components/studio/regenerate-demo-button";
import { bulkApproveAction, bulkRejectAction, bulkScheduleAction } from "./actions";

export type ReviewCardView = {
  id: string;
  status: DraftStatus;
  headline: string;
  sourceName: string;
  score: number | null;
  sensitive: boolean;
  awaitingRewrite: boolean;
  handle: string;
  slideLabel: string;
  timeLabel: string;
  coverSrc: string;
};

const TAB_STATUSES: { status: DraftStatus; label: string }[] = [
  { status: "needs_review", label: "Perlu review" },
  { status: "approved", label: "Disetujui" },
  { status: "scheduled", label: "Terjadwal" },
  { status: "failed", label: "Gagal posting" },
  { status: "posted", label: "Sudah posting" },
  { status: "simulasi", label: "Simulasi" },
  { status: "rejected", label: "Ditolak" },
];

export function ReviewPanel({
  cards,
  status,
  counts,
  canPublish,
  canWrite,
  isAdmin,
  demoReviewCount,
  regenerateProgress,
}: {
  cards: ReviewCardView[];
  status: DraftStatus;
  counts: Partial<Record<DraftStatus, number>>;
  canPublish: boolean;
  canWrite: boolean;
  isAdmin: boolean;
  demoReviewCount: number;
  regenerateProgress: { done: number; total: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scheduleAt, setScheduleAt] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  function toggleId(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setActionError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setActionError(result.error ?? "Terjadi kesalahan");
        return;
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  const selectedIds = [...selected];
  const selectedCards = cards.filter((card) => selected.has(card.id));
  const bulkAllows = (action: "approve" | "schedule" | "reject") =>
    selectedCards.every((card) => {
      if (!reviewActionVisible(card.status, action)) return false;
      if ((action === "approve" || action === "schedule") && card.awaitingRewrite) return false;
      return true;
    });

  return (
    <div className="p-6 md:p-8 space-y-6 pb-28">
      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">MEJA EDITOR</p>
        <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
          ANTRIAN REVIEW
        </h1>
        <p className="text-sm text-[var(--muted)] max-w-2xl">
          Cek fakta, edit kalau perlu, lalu setujui dan jadwalkan. Tidak ada yang terposting tanpa persetujuan
          tim.
        </p>
        {isAdmin && status === "needs_review" ? (
          <RegenerateDemoButton count={demoReviewCount} progress={regenerateProgress} />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {TAB_STATUSES.map((tab) => {
          const count = counts[tab.status] ?? 0;
          const active = tab.status === status;
          return (
            <Link
              key={tab.status}
              href={`/review?status=${tab.status}`}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)]"
                  : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink)] hover:border-[var(--ink)]"
              }`}
            >
              {tab.label} ({count})
            </Link>
          );
        })}
      </div>

      {(canPublish || canWrite) && (
        <div>
          <Button
            type="button"
            variant={bulkMode ? "default" : "outline"}
            size="sm"
            aria-pressed={bulkMode}
            onClick={() => {
              setBulkMode((v) => !v);
              setSelected(new Set());
            }}
          >
            Pilih beberapa
          </Button>
        </div>
      )}

      {actionError ? <p className="text-sm text-red-400">{actionError}</p> : null}

      {cards.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Tidak ada draf di tab ini.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <div key={card.id} className="relative group">
              {bulkMode ? (
                <label className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded bg-[var(--panel)]/90 px-2 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.has(card.id)}
                    onChange={() => toggleId(card.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  Pilih
                </label>
              ) : null}
              <Link
                href={`/review/${card.id}`}
                className="block rounded-lg border border-[var(--line)] bg-[var(--panel)] overflow-hidden hover:border-[var(--accent)] transition-colors"
              >
                <div className="aspect-[4/5] bg-[var(--panel-2)] relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={card.coverSrc} alt="" className="size-full object-cover" />
                </div>
                <div className="p-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                    <span>{card.slideLabel}</span>
                    {card.handle ? <span>@{card.handle}</span> : null}
                    {card.score != null ? (
                      <span className="font-mono text-[var(--accent)]">{card.score}</span>
                    ) : null}
                    {card.sensitive ? (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-200">
                        Cek risiko
                      </Badge>
                    ) : null}
                    {card.awaitingRewrite ? (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-200">
                        menunggu tulis ulang
                      </Badge>
                    ) : null}
                  </div>
                  <p className="font-medium line-clamp-2">{card.headline || "—"}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {card.sourceName} · {card.timeLabel}
                  </p>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      {bulkMode && selectedIds.length > 0 && (canPublish || canWrite) ? (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-[var(--line)] bg-[var(--panel)] p-4 flex flex-wrap items-end gap-3">
          {canPublish ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !bulkAllows("approve")}
                onClick={() => run(() => bulkApproveAction(selectedIds))}
              >
                Setujui
              </Button>
              <div className="flex flex-col gap-1">
                <Input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-auto border-[var(--line)] bg-[var(--panel-2)]"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || !scheduleAt || !bulkAllows("schedule")}
                  onClick={() => run(() => bulkScheduleAction(selectedIds, scheduleAt))}
                >
                  Jadwalkan
                </Button>
              </div>
            </>
          ) : null}
          {canWrite ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !bulkAllows("reject")}
              onClick={() => run(() => bulkRejectAction(selectedIds))}
            >
              Tolak
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
