"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { enqueue } from "@/src/jobs/runner";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireReviewWrite(): Promise<{ sql: Awaited<ReturnType<typeof getAppSql>> }> {
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
  return { sql };
}

export async function scoreWaitingNowAction(): Promise<ActionResult> {
  try {
    const { sql } = await requireReviewWrite();
    await enqueue(sql, {
      name: "analyst.score",
      payload: { rescoreWaiting: true },
      runAt: new Date(),
      manual: true,
    });
    revalidatePath("/radar");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Terjadi kesalahan";
    return { ok: false, error: message };
  }
}

export async function scanTopicsNowAction(): Promise<ActionResult> {
  try {
    const { sql } = await requireReviewWrite();
    await enqueue(sql, {
      name: "scout.scan",
      payload: {},
      runAt: new Date(),
      manual: true,
    });
    revalidatePath("/radar");
    revalidatePath("/overview");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Terjadi kesalahan";
    return { ok: false, error: message };
  }
}

export async function createContentAction(topicId: string): Promise<ActionResult> {
  try {
    const { sql } = await requireReviewWrite();
    await enqueue(sql, {
      name: "copywriter.write",
      payload: { topicId, force: true },
      runAt: new Date(),
      manual: true,
    });
    revalidatePath("/radar");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Terjadi kesalahan";
    return { ok: false, error: message };
  }
}
