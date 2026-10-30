import { getAppSql } from "@/src/auth/app-sql";
import type { Role } from "@/src/auth/rbac";
import { formatUsd } from "@/src/domain/metrics";
import { navItems } from "@/src/studio/nav";
import { llmBanner } from "@/src/llm/provider";
import { spendSummary } from "@/src/studio/spend";
import { logout } from "@/app/(studio)/actions";
import { StudioNavLinks } from "@/components/studio/nav-links";
import { Button } from "@/components/ui/button";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  social_media: "Social Media",
  viewer: "Viewer",
  kol_specialist: "KOL Specialist",
};

const gridStyle = {
  backgroundColor: "var(--bg)",
  backgroundImage:
    "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
  backgroundSize: "32px 32px",
  colorScheme: "dark" as const,
};

function userInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

export default async function Shell({
  user,
  children,
}: {
  user: { id: string; name: string; role: Role };
  children: React.ReactNode;
}) {
  const sql = await getAppSql();
  const brandRows = await sql.rows<{ handle: string; name: string }>(
    "select handle, name from brand where id = 1",
  );
  const handle = brandRows[0]?.handle?.trim() ?? "";
  const brandName = brandRows[0]?.name?.trim() || "Analyst Digest";
  const spend = await spendSummary(sql, new Date());
  const demoAi = llmBanner().provider === "demo";
  const todayUsd = demoAi ? 0 : spend.today;
  const monthUsd = demoAi ? 0 : spend.month;
  const spendNote = demoAi ? " (simulasi)" : "";
  const reviewRows = await sql.rows<{ count: string }>(
    "select count(*)::int as count from drafts where status = 'needs_review'",
  );
  const reviewCount = Number(reviewRows[0]?.count ?? 0);
  const items = navItems(user.role);

  return (
    <div className="min-h-screen flex flex-col md:flex-row text-[var(--ink)]" style={gridStyle}>
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--panel)]">
        <div className="px-4 pt-6 pb-4 border-b border-[var(--line)] space-y-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-[var(--ink)]">{brandName}</p>
          {handle ? <p className="text-sm text-[var(--muted)]">@{handle}</p> : null}
        </div>
        <div className="flex-1 py-4 overflow-y-auto">
          <StudioNavLinks items={items} reviewCount={reviewCount} orientation="vertical" />
        </div>
        <div className="border-t border-[var(--line)] p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--panel-2)] text-sm font-semibold text-[var(--accent)]">
              {userInitial(user.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-xs text-[var(--muted)]">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <form action={logout}>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="w-full border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-[var(--panel-2)]"
            >
              Keluar
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-4 py-3">
          <p className="text-sm text-[var(--muted)] md:hidden">
            <span className="font-semibold tracking-wide text-[var(--ink)]">{brandName}</span>
            {handle ? <span className="ml-2">@{handle}</span> : null}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)] ml-auto">
            <span>
              AI Hari ini{spendNote}{" "}
              <span className="font-mono text-[var(--ink)]">{formatUsd(todayUsd)}</span>
            </span>
            <span>
              Bulan ini{spendNote}{" "}
              <span className="font-mono text-[var(--ink)]">{formatUsd(monthUsd)}</span>
            </span>
          </div>
        </header>
        <div className="md:hidden flex items-center gap-2 border-b border-[var(--line)] bg-[var(--panel)] py-2">
          <StudioNavLinks items={items} reviewCount={reviewCount} orientation="horizontal" />
          <form action={logout} className="shrink-0 pr-3">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="border-[var(--line)] bg-transparent text-[var(--ink)] hover:bg-[var(--panel-2)]"
            >
              Keluar
            </Button>
          </form>
        </div>
        <main className="flex-1 min-h-0">{children}</main>
      </div>
    </div>
  );
}
