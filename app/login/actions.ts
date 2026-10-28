"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { verifyPassword } from "@/src/auth/password";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/src/auth/session";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const sql = await getAppSql();
  const rows = await sql.rows<{ id: string; password_hash: string }>(
    "select id, password_hash from users where lower(email) = $1",
    [email],
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    redirect("/login?error=1");
  }
  const session = await createSession(sql, user.id);
  await sql.rows("update users set last_login_at = now() where id = $1", [user.id]);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/overview");
}
