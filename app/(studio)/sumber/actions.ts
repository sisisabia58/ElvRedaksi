"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import {
  addSource,
  deleteSource,
  setSourceEnabled,
} from "@/src/studio/sources";

export type ActionResult = { ok: true } | { ok: false; error: string };

function toActionResult(error: unknown): ActionResult {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Data tidak valid" };
  }
  if (error instanceof Error) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "Terjadi kesalahan" };
}

async function requireSourceAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    throw new Error("forbidden");
  }
  const sql = await getAppSql();
  const user = await userForToken(sql, token);
  if (!user || !can(user.role, "source.write")) {
    throw new Error("forbidden");
  }
  return { sql, user };
}

export async function addSourceAction(input: {
  name: string;
  url: string;
  lang: "ID" | "EN";
}): Promise<ActionResult> {
  try {
    const { sql, user } = await requireSourceAdmin();
    await addSource(sql, user.role, input);
    revalidatePath("/sumber");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function setSourceEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  try {
    const { sql, user } = await requireSourceAdmin();
    await setSourceEnabled(sql, user.role, id, enabled);
    revalidatePath("/sumber");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function deleteSourceAction(id: string): Promise<ActionResult> {
  try {
    const { sql, user } = await requireSourceAdmin();
    await deleteSource(sql, user.role, id);
    revalidatePath("/sumber");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}

export type SourceView = {
  id: string;
  name: string;
  url: string;
  lang: "ID" | "EN";
  enabled: boolean;
  topicCount: number;
  passCount7d: number;
  lastError: string | null;
  lastCheckedLabel: string;
};
