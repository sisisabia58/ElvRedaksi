import { getAppSql } from "@/src/auth/app-sql";
import { funnelCounts } from "@/src/studio/overview";

export default async function OverviewPage() {
  const sql = await getAppSql();
  const funnel = await funnelCounts(sql);

  return (
    <div className="p-6 md:p-8 space-y-8">
      <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
        RUANG REDAKSI
      </h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FunnelCard
          title="TOPIK MASUK 24 JAM"
          value={funnel.arrived24h}
          detail={`${funnel.waitingScore} menunggu dinilai`}
        />
        <FunnelCard
          title="LOLOS ANALIS 24 JAM"
          value={funnel.passed24h}
          detail={`${funnel.waitingDraft} antre ditulis`}
        />
        <FunnelCard
          title="SIAP DIREVIEW"
          value={funnel.needsReview}
          detail="Butuh approval tim"
          accent
        />
        <FunnelCard
          title="TERJADWAL"
          value={funnel.scheduled}
          detail={`${funnel.postedThisWeek} sudah posting minggu ini`}
        />
      </div>
    </div>
  );
}

function FunnelCard({
  title,
  value,
  detail,
  accent,
}: {
  title: string;
  value: number;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-2">
      <p className="text-xs font-medium tracking-wide text-[var(--muted)] uppercase">{title}</p>
      <p
        className={`text-3xl font-semibold tabular-nums ${accent ? "text-[var(--accent)]" : "text-[var(--ink)]"}`}
      >
        {value}
      </p>
      <p className="text-sm text-[var(--muted)]">{detail}</p>
    </div>
  );
}
