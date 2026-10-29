"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { can, type Role } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import type { Slide } from "@/src/agents/copywriter";
import {
  approveDraft,
  bulkApproveDrafts,
  bulkRejectDrafts,
  bulkScheduleDrafts,
  deleteDraft,
  getDraft,
  markPostedManually,
  postDraftNow,
  rejectDraft,
  retryFailed,
  saveCoverPhoto,
  saveDraftText,
  saveFocal,
  scheduleDraft,
  setFormat,
  setTemplate,
} from "@/src/studio/drafts";
import { enqueue } from "@/src/jobs/runner";
import { demoRewriteSnapshot, enqueueDemoRegeneration, type DemoRewriteSnapshot } from "@/src/studio/regenerate-demo";

export type ActionResult = { ok: true } | { ok: false; error: string };

export type RegenerateDemoResult = { ok: true; queued: number } | { ok: false; error: string };

export async function demoRewriteSnapshotAction(): Promise<DemoRewriteSnapshot | null> {
  try {
    const { sql } = await sessionUser();
    return demoRewriteSnapshot(sql);
  } catch {
    return null;
  }
}

export async function regenerateDemoDraftsAction(): Promise<RegenerateDemoResult> {
  try {
    const { sql, role } = await sessionUser();
    if (role !== "admin") {
      throw new Error("forbidden");
    }
    const queued = await enqueueDemoRegeneration(sql);
    revalidatePath("/review");
    revalidatePath("/pengaturan");
    return { ok: true, queued };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

async function sessionUser(): Promise<{
  sql: Awaited<ReturnType<typeof getAppSql>>;
  role: Role;
}> {
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
  return { sql, role: user.role };
}

function revalidateReview(id?: string) {
  revalidatePath("/review");
  if (id) {
    revalidatePath(`/review/${id}`);
  }
}

async function refusePostingDraft(
  sql: Awaited<ReturnType<typeof getAppSql>>,
  id: string,
): Promise<void> {
  const draft = await getDraft(sql, id);
  if (draft?.status === "posting") {
    throw new Error("Draf sedang diposting");
  }
}

export async function approveDraftAction(id: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await approveDraft(sql, role, id);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function scheduleDraftAction(id: string, scheduledAtIso: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await scheduleDraft(sql, role, id, new Date(scheduledAtIso));
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function postDraftNowAction(id: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await postDraftNow(sql, role, id);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function markPostedManuallyAction(id: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await markPostedManually(sql, role, id);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function rejectDraftAction(id: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await rejectDraft(sql, role, id);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function deleteDraftAction(id: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await deleteDraft(sql, role, id);
    revalidateReview();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function retryFailedAction(id: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await retryFailed(sql, role, id);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function bulkApproveAction(ids: string[]): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await bulkApproveDrafts(sql, role, ids);
    revalidateReview();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function bulkScheduleAction(ids: string[], wibLocal: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    const scheduledAt = new Date(`${wibLocal}+07:00`);
    await bulkScheduleDrafts(sql, role, ids, scheduledAt);
    revalidateReview();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function bulkRejectAction(ids: string[]): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await bulkRejectDrafts(sql, role, ids);
    revalidateReview();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

type SaveInput = {
  slides: Slide[];
  caption: string;
  hashtags: string[];
  altHeadlines: [string, string];
  kicker: string;
};

export async function saveDraftTextAction(id: string, input: SaveInput): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await saveDraftText(sql, role, id, input);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function saveAndRenderAction(id: string, input: SaveInput): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await refusePostingDraft(sql, id);
    await saveDraftText(sql, role, id, input);
    await refusePostingDraft(sql, id);
    await enqueue(sql, {
      name: "designer.render",
      payload: { draftId: id },
      runAt: new Date(),
      manual: true,
    });
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function saveFocalAction(id: string, focalY: number): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await saveFocal(sql, role, id, focalY);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function saveCoverPhotoAction(id: string, photoDataUrl: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await saveCoverPhoto(sql, role, id, photoDataUrl);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function setFormatAction(
  id: string,
  format: "carousel_full" | "teaser_bio",
): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await setFormat(sql, role, id, format);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function setTemplateAction(
  id: string,
  template: "stabilo" | "foto_penuh" | "serif" | "catatan" | "berita_pro",
): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    await setTemplate(sql, role, id, template);
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function rewriteCopyAction(topicId: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    if (!can(role, "review.write")) {
      throw new Error("forbidden");
    }
    await enqueue(sql, {
      name: "copywriter.write",
      payload: { topicId, rewrite: true, force: true },
      runAt: new Date(),
      manual: true,
    });
    revalidateReview();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}

export async function renderAgainAction(id: string): Promise<ActionResult> {
  try {
    const { sql, role } = await sessionUser();
    if (!can(role, "review.write")) {
      throw new Error("forbidden");
    }
    await refusePostingDraft(sql, id);
    await enqueue(sql, {
      name: "designer.render",
      payload: { draftId: id },
      runAt: new Date(),
      manual: true,
    });
    revalidateReview(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Terjadi kesalahan" };
  }
}
