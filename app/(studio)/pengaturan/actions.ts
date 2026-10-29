"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { changeOwnPassword } from "@/src/auth/account";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import type { SettingsInput } from "@/src/studio/settings";
import { saveInstagramToken, saveSettings } from "@/src/studio/settings";

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

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    throw new Error("forbidden");
  }
  const sql = await getAppSql();
  const user = await userForToken(sql, token);
  if (!user || user.role !== "admin") {
    throw new Error("forbidden");
  }
  return { sql, user };
}

export async function saveSettingsAction(input: SettingsInput): Promise<ActionResult> {
  try {
    const { sql, user } = await requireAdmin();
    await saveSettings(sql, user.role, input);
    revalidatePath("/pengaturan");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function saveInstagramConnectAction(
  igUserId: string,
  accessToken: string,
  username: string,
): Promise<ActionResult> {
  try {
    const { sql, user } = await requireAdmin();
    await saveInstagramToken(sql, user.role, {
      igUserId,
      accessToken,
      username,
    });
    revalidatePath("/pengaturan");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function changePasswordAction(
  currentPassword: string,
  nextPassword: string,
  confirmPassword: string,
): Promise<ActionResult> {
  try {
    const { sql, user } = await requireAdmin();
    await changeOwnPassword(sql, user.id, {
      current: currentPassword,
      next: nextPassword,
      confirm: confirmPassword,
    });
    revalidatePath("/pengaturan");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function disconnectInstagramAction(): Promise<ActionResult> {
  try {
    const { sql, user } = await requireAdmin();
    await saveInstagramToken(sql, user.role, {
      igUserId: "",
      accessToken: "",
      username: "",
    });
    revalidatePath("/pengaturan");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}
