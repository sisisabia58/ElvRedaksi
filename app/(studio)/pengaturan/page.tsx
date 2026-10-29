import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { llmBanner } from "@/src/llm/provider";
import { countDemoReviewDrafts, regenerateProgress } from "@/src/studio/regenerate-demo";
import { getSettings } from "@/src/studio/settings";
import { PengaturanForm } from "./pengaturan-form";

export default async function PengaturanPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const sql = await getAppSql();
  const user = token ? await userForToken(sql, token) : null;
  if (!user || user.role !== "admin") {
    redirect("/overview");
  }

  const settings = await getSettings(sql);
  const showMetaBanner = (process.env.META_PROVIDER ?? "fake") !== "meta";
  const [demoReviewCount, progress] = await Promise.all([
    countDemoReviewDrafts(sql),
    regenerateProgress(sql),
  ]);

  return (
    <PengaturanForm
      settings={settings}
      showMetaBanner={showMetaBanner}
      llmBanner={llmBanner().text}
      demoReviewCount={demoReviewCount}
      regenerateProgress={progress}
    />
  );
}
