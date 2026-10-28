"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { createNote, deleteNote, saveBrain } from "@/src/studio/brain";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateNoteResult = { ok: true; slug: string } | { ok: false; error: string };

function toActionResult(error: unknown): ActionResult {
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Data tidak valid" };
  }
  if (error instanceof Error) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "Terjadi kesalahan" };
}

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

export async function saveBrainAction(slug: string, body: string): Promise<ActionResult> {
  try {
    const { sql, user } = await requireUser();
    await saveBrain(sql, user.role, { slug, body });
    revalidatePath("/brain");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}

export async function createNoteAction(title: string): Promise<CreateNoteResult> {
  try {
    const { sql, user } = await requireUser();
    const note = await createNote(sql, user.role, title);
    revalidatePath("/brain");
    return { ok: true, slug: note.slug };
  } catch (error) {
    const failed = toActionResult(error);
    if (!failed.ok) {
      return failed;
    }
    return { ok: false, error: "Terjadi kesalahan" };
  }
}

export async function deleteNoteAction(slug: string): Promise<ActionResult> {
  try {
    const { sql, user } = await requireUser();
    await deleteNote(sql, user.role, slug);
    revalidatePath("/brain");
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
  }
}
