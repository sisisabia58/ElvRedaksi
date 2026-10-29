"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { can, type Role } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { inviteUser } from "@/src/studio/team";

export type InviteResult = { ok: true; password: string } | { ok: false; error: string };

function toActionResult(error: unknown): InviteResult {
  if (error instanceof Error) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "Terjadi kesalahan" };
}

async function requireTeamWriter() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    throw new Error("forbidden");
  }
  const sql = await getAppSql();
  const user = await userForToken(sql, token);
  if (!user || !can(user.role, "team.write")) {
    throw new Error("forbidden");
  }
  return { sql, user };
}

export async function inviteUserAction(input: {
  name: string;
  email: string;
  role: Role;
}): Promise<InviteResult> {
  try {
    const { sql, user } = await requireTeamWriter();
    const created = await inviteUser(sql, user.role, input);
    revalidatePath("/tim");
    return { ok: true, password: created.password };
  } catch (error) {
    return toActionResult(error);
  }
}
