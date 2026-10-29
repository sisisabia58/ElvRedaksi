"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { regenerateDemoDraftsAction } from "@/app/(studio)/review/actions";
import { Button } from "@/components/ui/button";

export function RegenerateDemoButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--muted)]">
        {count} draf di Perlu review masih memakai skor dan naskah demo. Tombol ini menilai
        dan menulis ulang draf itu, lalu menggambar ulang slidenya. Status tetap Perlu review.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pending || count === 0}
        className="border-[var(--line)]"
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const result = await regenerateDemoDraftsAction();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMessage(
              result.queued === 0
                ? "Tidak ada draf demo di Perlu review."
                : `${result.queued} draf masuk antrean. Status tetap Perlu review.`,
            );
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
