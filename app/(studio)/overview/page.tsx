import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { relativeId } from "@/src/domain/metrics";
import { greeting, isWithinWorkHours } from "@/src/domain/time";
import { readGeminiPause } from "@/src/llm/gemini-gate";
import {
  agentCards,
  funnelCounts,
  newsroomQueues,
  overviewStatusChip,
  recentActivity,
  renderProgressLabel,
  rewriteQueueLabel,
  type AgentId,
} from "@/src/studio/overview";
import { OverviewScanButton } from "./overview-scan-button";

const AGENT_PRESENTATION: Record<AgentId, { label: string; color: string }> = {
  scout: { label: "Scout", color: "#38bdf8" },
  analis: { label: "Analis", color: "#a78bfa" },
  copywriter: { label: "Copywriter", color: "#fbbf24" },
  designer: { label: "Designer", color: "#f472b6" },
};

const DEFAULT_WORK_START = "07:00";
const DEFAULT_WORK_END = "22:00";

function agentLabel(agent: string): { label: string; color: string } {
  if (agent in AGENT_PRESENTATION) {
    return AGENT_PRESENTATION[agent as AgentId];
  }
  const label = agent ? agent.charAt(0).toUpperCase() + agent.slice(1) : agent;
  return { label, color: "var(--muted)" };
}

export default async function OverviewPage() {
  const sql = await getAppSql();
  const now = new Date();
  const [funnel, cards, activity, hourRows, geminiPause, queues] = await Promise.all([
    funnelCounts(sql, now),
    agentCards(sql, now),
    recentActivity(sql),
    sql.rows<{ work_start: string; work_end: string }>(
      "select work_start, work_end from brand where id = 1",
    ),
    readGeminiPause(sql),
    newsroomQueues(sql),
  ]);
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const user = token ? await userForToken(sql, token) : null;
  const canScan = user ? can(user.role, "review.write") : false;
  const workStart = hourRows[0]?.work_start || DEFAULT_WORK_START;
  const workEnd = hourRows[0]?.work_end || DEFAULT_WORK_END;
  const awake = isWithinWorkHours(now, workStart, workEnd);
  const greetingWord = greeting(now).toUpperCase();
  const name = user?.name.trim().toUpperCase() ?? "";
  const kicker = name ? `SELAMAT ${greetingWord}, ${name}` : `SELAMAT ${greetingWord}`;
  const quotaPaused = Boolean(geminiPause?.perDay);
  const hoursChip = overviewStatusChip({
    awake,
    workStart,
    workEnd,
    geminiPause: quotaPaused ? geminiPause?.message ?? null : null,
  });

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">{kicker}</p>
          <h1 className="font-[family-name:var(--font-anton)] text-2xl md:text-3xl uppercase tracking-wide">
            RUANG REDAKSI
          </h1>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
              Mode: Semi-otomatis
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-xs ${
                quotaPaused
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-100"
                  : "border-[var(--line)] bg-[var(--panel)] text-[var(--muted)]"
              }`}
            >
              {hoursChip}
            </span>
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
              {rewriteQueueLabel(queues.rewriteQueue)}
            </span>
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
              {renderProgressLabel(queues.renderDone, queues.reviewDrafts, queues.renderOpen)}
            </span>
          </div>
          {canScan ? <OverviewScanButton /> : null}
        </div>
      </div>
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const presentation = AGENT_PRESENTATION[card.agent];
          const subline = card.running
            ? "Lagi jalan"
            : card.lastAt
              ? `Standby · aktif ${relativeId(card.lastAt, now)}`
              : "Belum pernah jalan";
          return (
            <div
              key={card.agent}
              className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 space-y-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: presentation.color }}
                  aria-hidden
                />
                <p className="text-sm font-semibold tracking-wide">{presentation.label}</p>
              </div>
              <p className="text-sm text-[var(--ink)]">{card.role}</p>
              <p
                className={`text-sm ${card.running ? "" : "text-[var(--muted)]"}`}
                style={card.running ? { color: presentation.color } : undefined}
              >
                {subline}
              </p>
            </div>
          );
        })}
      </div>
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-wide">Aktivitas Redaksi</h2>
          <p className="text-xs text-[var(--muted)]">update otomatis</p>
        </div>
        {activity.length > 0 ? (
          <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--panel)]">
            {activity.map((item, index) => {
              const presentation = agentLabel(item.agent);
              return (
                <li
                  key={`${item.agent}-${item.at.toISOString()}-${index}`}
                  className="flex items-baseline justify-between gap-4 px-4 py-3"
                >
                  <p className="text-sm">
                    <span className="font-medium" style={{ color: presentation.color }}>
                      {presentation.label}
                    </span>{" "}
                    <span>{item.message}</span>
                  </p>
                  <time className="shrink-0 text-xs text-[var(--muted)]" dateTime={item.at.toISOString()}>
                    {relativeId(item.at, now)}
                  </time>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
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
