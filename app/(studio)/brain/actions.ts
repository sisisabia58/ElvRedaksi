"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { createNote, deleteNote, saveBrain } from "@/src/studio/brain";

async function requireUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    throw new Error("forbidden");
  }
  const sql = await getAppSql();
  const user = await userForToken(sql, token);
  if (!user) {
    throw new Error("forbidden");
  }
  return { sql, user };
}

export async function saveBrainAction(slug: string, body: string) {
  const { sql, user } = await requireUser();
  await saveBrain(sql, user.role, { slug, body });
  revalidatePath("/brain");
}

export async function createNoteAction(title: string) {
  const { sql, user } = await requireUser();
  const note = await createNote(sql, user.role, title);
  revalidatePath("/brain");
  return note.slug;
}

export async function deleteNoteAction(slug: string) {
  const { sql, user } = await requireUser();
  await deleteNote(sql, user.role, slug);
  revalidatePath("/brain");
}
