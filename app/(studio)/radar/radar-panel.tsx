"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createContentAction,
  scanTopicsNowAction,
  scoreWaitingNowAction,
} from "./actions";
import type { Filter } from "@/src/studio/topics";

export type RadarTopicView = {
  id: string;
  title: string;
  score: number | null;
  state: string;
  sensitive: boolean;
  tags: string[];
  sourceName: string;
  timeLabel: string;
  badge: "Lolos" | "Dilewati" | null;
};

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: "passed", label: "Lolos analis" },
  { value: "all", label: "Semua" },
  { value: "waiting", label: "Menunggu dinilai" },
  { value: "skipped", label: "Dilewati" },
  { value: "failed", label: "Gagal" },
  { value: "drafted", label: "Sudah jadi draft" },
];

export function RadarPanel({
  topics,
  filter,
  sort,
  q,
  waitingCount,
  canWrite,
}: {
  topics: RadarTopicView[];
  filter: Filter;
  sort: "new" | "score";
  q: string;
  waitingCount: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const [actionError, setActionError] = useState<string | null>(null);

  function linkWith(params: Record<string, string>) {
    const sp = new URLSearchParams({ filter, sort, q });
    for (const [k, v] of Object.entries(params)) {
      if (v) {
        sp.set(k, v);
      } else {
        sp.delete(k);
      }
    }
    return `/radar?${sp.toString()}`;
  }

  function runAction(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setActionError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setActionError(result.error ?? "Terjadi kesalahan");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)] uppercase">
            SCOUT + ANALIS
          </p>
          <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
            RADAR TOPIK
          </h1>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Topik 3 hari terakhir yang belum dibuatkan konten, terbaru di atas. Ada yang dilewati
            padahal menurutmu bagus? Klik &quot;Buatkan konten&quot;. Yang sudah jadi draft pindah ke
            Antrian Review.
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => runAction(scoreWaitingNowAction)}
            >
              Nilai {waitingCount} topik sekarang
            </Button>
            <Button type="button" disabled={pending} onClick={() => runAction(scanTopicsNowAction)}>
              Cari topik sekarang
            </Button>
          </div>
        ) : null}
      </div>

      {actionError ? <p className="text-sm text-[var(--bad)]">{actionError}</p> : null}

      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => (
          <Link
            key={opt.value}
            href={linkWith({ filter: opt.value })}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === opt.value
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--ink)]"
                : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--ink)]"
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <form
          className="flex gap-2 flex-1 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(linkWith({ q: search.trim() }));
          }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul…"
            className="border-[var(--line)] bg-[var(--panel)]"
          />
          <Button type="submit" variant="outline">
            Cari
          </Button>
        </form>
        <div className="flex gap-2 text-sm">
          <Link
            href={linkWith({ sort: "new" })}
            className={sort === "new" ? "text-[var(--accent)] font-medium" : "text-[var(--muted)]"}
          >
            Terbaru
          </Link>
          <span className="text-[var(--line)]">|</span>
          <Link
            href={linkWith({ sort: "score" })}
            className={sort === "score" ? "text-[var(--accent)] font-medium" : "text-[var(--muted)]"}
          >
            Skor tertinggi
          </Link>
        </div>
      </div>

      {topics.length === 0 ? (
        <p className="text-sm text-[var(--muted)] py-8 text-center border border-dashed border-[var(--line)] rounded-lg">
          Belum ada topik. Tambah sumber atau cari sekarang.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-lg bg-[var(--panel)]">
          {topics.map((topic) => (
            <li key={topic.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={`text-2xl font-semibold tabular-nums min-w-[3ch] ${
                    topic.score != null ? "text-[var(--accent)]" : "text-[var(--muted)]"
                  }`}
                >
                  {topic.score ?? "–"}
                </span>
                {topic.badge ? (
                  <Badge variant={topic.badge === "Lolos" ? "default" : "secondary"}>
                    {topic.badge}
                  </Badge>
                ) : null}
                {topic.sensitive && topic.state === "passed" ? (
                  <Badge variant="outline" className="border-[var(--bad)] text-[var(--bad)]">
                    Cek risiko
                  </Badge>
                ) : null}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                  {topic.tags.map((tag) => (
                    <span key={tag} className="rounded bg-[var(--panel-2)] px-2 py-0.5">
                      {tag}
                    </span>
                  ))}
                  <span>{topic.sourceName}</span>
                  <span>{topic.timeLabel}</span>
                </div>
                <p className="font-medium text-[var(--ink)] truncate">{topic.title}</p>
              </div>
              {canWrite && topic.state !== "drafted" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  className="shrink-0"
                  onClick={() =>
                    runAction(async () => createContentAction(topic.id))
                  }
                >
                  Buatkan konten
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
