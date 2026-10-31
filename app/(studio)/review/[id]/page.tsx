import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { backfillDraftPermalink } from "@/src/instagram/permalink";
import { livePublishBlock, practiceBanner, readPracticeMode, envForcesPractice } from "@/src/publish/mode";
import { getDraft } from "@/src/studio/drafts";
import { EditorPanel } from "./editor-panel";

type PageParams = { params: Promise<{ id: string }> };

export default async function ReviewEditorPage({ params }: PageParams) {
  const { id } = await params;
  const sql = await getAppSql();
  const draft = await getDraft(sql, id);
  if (!draft) {
    notFound();
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const user = token ? await userForToken(sql, token) : null;
  if (!user) {
    notFound();
  }

  const permalink = await backfillDraftPermalink(sql, {
    id: draft.id,
    status: draft.status,
    igMediaId: draft.igMediaId,
    permalink: draft.permalink,
  });
  const practice = await readPracticeMode(sql);
  const igRows = await sql.rows<{ username: string | null }>(
    "select username from ig_connection where id = 1",
  );
  const block = await livePublishBlock(sql);
  const usePublicMedia = draft.status === "posted" || draft.status === "posting";

  return (
    <EditorPanel
      draft={{
        id: draft.id,
        topicId: draft.topicId,
        status: draft.status,
        format: draft.format,
        template: draft.template,
        slides: draft.slides,
        caption: draft.caption,
        hashtags: draft.hashtags,
        altHeadlines: draft.altHeadlines,
        focalY: draft.focalY,
        shortCode: draft.shortCode,
        clickCount: draft.clickCount,
        textDirty: draft.textDirty,
        sensitive: draft.sensitive,
        score: draft.score,
        sourceName: draft.sourceName,
        handle: draft.handle,
        postedAt: draft.postedAt ? new Date(draft.postedAt).toISOString() : null,
        permalink,
        topicUrl: draft.topicUrl,
        slideCount: draft.slideCount,
        usePublicMedia,
        assetIds: draft.assetIds,
        updatedAt: new Date(draft.updatedAt).toISOString(),
      }}
      canPublish={can(user.role, "publish")}
      canWrite={can(user.role, "review.write")}
      modeBanner={practiceBanner({
        practice,
        envLocked: envForcesPractice(),
        username: igRows[0]?.username ?? null,
      })}
      blockPublish={block != null}
    />
  );
}
