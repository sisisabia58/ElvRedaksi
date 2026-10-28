"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { enqueue } from "@/src/jobs/runner";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function syncInsightsNowAction(): Promise<ActionResult> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) {
      throw new Error("forbidden");
    }
    const sql = await getAppSql();
    const user = await userForToken(sql, token);
    if (!user || !can(user.role, "review.write")) {
      throw new Error("forbidden");
    }
    await enqueue(sql, {
      name: "insights.sync",
      payload: {},
      runAt: new Date(),
      manual: true,
    });
    revalidatePath("/analitik");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Terjadi kesalahan";
    return { ok: false, error: message };
  }
}
