"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import type { SettingsInput } from "@/src/studio/settings";
import { getSettings, saveInstagramToken, saveSettings } from "@/src/studio/settings";

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

export async function saveSettingsAction(input: SettingsInput) {
  const { sql, user } = await requireAdmin();
  await saveSettings(sql, user.role, input);
  revalidatePath("/pengaturan");
}

export async function saveInstagramConnectAction(igUserId: string, accessToken: string) {
  const { sql, user } = await requireAdmin();
  const settings = await getSettings(sql);
  await saveInstagramToken(sql, user.role, {
    igUserId,
    accessToken,
    username: settings.handle,
  });
  revalidatePath("/pengaturan");
}

export async function disconnectInstagramAction() {
  const { sql, user } = await requireAdmin();
  await saveInstagramToken(sql, user.role, {
    igUserId: "",
    accessToken: "",
    username: "",
  });
  revalidatePath("/pengaturan");
}
