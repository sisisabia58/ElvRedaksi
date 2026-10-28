"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { deleteSessionForToken, SESSION_COOKIE } from "@/src/auth/session";

export async function logout() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const sql = await getAppSql();
    await deleteSessionForToken(sql, token);
  }
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
