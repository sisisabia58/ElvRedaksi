import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { can, type Role } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { listUsers } from "@/src/studio/team";
import { TimPanel, type TeamMemberView } from "./tim-panel";

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  social_media: "Social Media",
  viewer: "Viewer",
  kol_specialist: "KOL Specialist",
};

export default async function TimPage() {
  const sql = await getAppSql();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const user = token ? await userForToken(sql, token) : null;
  if (!user || !can(user.role, "team.write")) {
    redirect("/overview");
  }

  const users = await listUsers(sql);
  const members: TeamMemberView[] = users.map((member) => ({
    name: member.name,
    email: member.email,
    roleLabel: ROLE_LABELS[member.role],
    loginLabel: member.lastLoginAt ? "login terakhir baru saja" : "belum pernah login",
  }));

  return <TimPanel members={members} />;
}
