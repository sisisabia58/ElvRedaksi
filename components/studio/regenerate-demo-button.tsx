"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { demoRewriteSnapshotAction, regenerateDemoDraftsAction } from "@/app/(studio)/review/actions";
import { Button } from "@/components/ui/button";
import { demoRewriteSummary } from "@/src/studio/demo-rewrite-summary";

export function RegenerateDemoButton({
  count,
  progress,
}: {
  count: number;
  progress: { done: number; total: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState({ count, done: progress.done, total: progress.total });
  useEffect(() => {
    setLive({ count, done: progress.done, total: progress.total });
  }, [count, progress.done, progress.total]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const next = await demoRewriteSnapshotAction();
      if (!stop && next) {
        setLive({ count: next.demoScores, done: next.done, total: next.total });
      }
    };
    const timer = window.setInterval(() => {
      void tick();
    }, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);
  const summary = demoRewriteSummary({
    demoScores: live.count,
    done: live.done,
    total: live.total,
  });

  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--muted)]">
        {summary.score} Tombol ini menilai dan menulis ulang draf itu, lalu menggambar ulang
        slidenya. Status tetap Perlu review.
      </p>
      {summary.queue ? <p className="text-sm text-[var(--ink)]">{summary.queue}</p> : null}
      <Button
        type="button"
        variant="outline"
        disabled={pending || live.count === 0}
        className="border-[var(--line)]"
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const result = await regenerateDemoDraftsAction();
            if (!result.ok) {
              setError(result.error);
              toast.error(result.error);
              return;
            }
            const notice =
              result.queued === 0
                ? "Tidak ada draf demo di Perlu review."
                : `${result.queued} draf masuk antrian tulis ulang`;
            setMessage(notice);
            toast.success(notice);
            router.refresh();
          });
        }}
      >
        Tulis ulang draf demo
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-sm text-[var(--muted)]">{message}</p> : null}
    </div>
  );
}
