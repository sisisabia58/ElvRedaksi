"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { syncInsightsNowAction } from "./actions";

export function SyncInsightsButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-stretch sm:items-end gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await syncInsightsNowAction();
            if (!result.ok) {
              setError(result.error);
            }
          });
        }}
      >
        Sinkronkan sekarang
      </Button>
      {error ? <p className="text-sm text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}
