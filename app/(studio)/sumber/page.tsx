import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { relativeId } from "@/src/domain/metrics";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { listSources } from "@/src/studio/sources";
import { SumberPanel } from "./sumber-panel";

export default async function SumberPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sql = await getAppSql();
  const user = token ? await userForToken(sql, token) : null;
  if (!user || !can(user.role, "source.write")) {
    redirect("/overview");
  }

  const now = new Date();
  const sources = await listSources(sql);
  const views = sources.map((source) => ({
    ...source,
    lastCheckedLabel: source.lastFetchedAt
      ? `dicek ${relativeId(source.lastFetchedAt, now)}`
      : "belum pernah",
  }));

  return <SumberPanel sources={views} />;
}
