"use client";

import { useState, useTransition } from "react";
import { scanTopicsNowAction } from "./actions";
import { Button } from "@/components/ui/button";

export function OverviewScanButton() {
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
            const result = await scanTopicsNowAction();
            if (!result.ok) {
              setError(result.error);
            }
          });
        }}
      >
        Cari topik sekarang
      </Button>
      {error ? <p className="text-sm text-[var(--bad)]">{error}</p> : null}
    </div>
  );
}
