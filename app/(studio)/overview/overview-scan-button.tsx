"use client";

import { useTransition } from "react";
import { scanTopicsNowAction } from "./actions";
import { Button } from "@/components/ui/button";

export function OverviewScanButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await scanTopicsNowAction();
        });
      }}
    >
      Cari topik sekarang
    </Button>
  );
}
