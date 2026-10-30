import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { relativeId } from "@/src/domain/metrics";
import { DRAFT_STATUSES, type DraftStatus } from "@/src/domain/status";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { countDraftsByStatus, listDrafts } from "@/src/studio/drafts";
import { demoRewriteSnapshot } from "@/src/studio/regenerate-demo";
import { ReviewPanel } from "./review-panel";

function parseStatus(raw: string | undefined): DraftStatus {
  if (raw && DRAFT_STATUSES.includes(raw as DraftStatus)) {
    return raw as DraftStatus;
  }
  return "needs_review";
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const sql = await getAppSql();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const user = token ? await userForToken(sql, token) : null;
  if (!user) {
    notFound();
  }

  const now = new Date();
  const [drafts, counts, rewrite] = await Promise.all([
    listDrafts(sql, status),
    countDraftsByStatus(sql),
    demoRewriteSnapshot(sql),
  ]);

  const cards = drafts.map((draft) => {
    const usePublicMedia =
      (draft.status === "posted" || draft.status === "posting") && draft.assetId;
    const coverSrc = usePublicMedia
      ? `/media/${draft.assetId}`
      : `/review/${draft.id}/slide/0`;
    return {
      id: draft.id,
      status: draft.status,
      headline: draft.headline,
      sourceName: draft.sourceName,
      score: draft.score,
      sensitive: draft.sensitive,
      awaitingRewrite: draft.awaitingRewrite,
      handle: draft.handle,
      slideLabel: `1/${draft.slideCount}`,
      timeLabel: relativeId(draft.updatedAt, now),
      coverSrc,
    };
  });

  return (
    <ReviewPanel
      cards={cards}
      status={status}
      counts={counts}
      canPublish={can(user.role, "publish")}
      canWrite={can(user.role, "review.write")}
      isAdmin={user.role === "admin"}
      demoReviewCount={rewrite.demoScores}
      regenerateProgress={{ done: rewrite.done, total: rewrite.total }}
    />
  );
}
