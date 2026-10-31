import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { readGeminiPause } from "@/src/llm/gemini-gate";
import { llmBanner, studioModelLine } from "@/src/llm/provider";
import { demoRewriteSnapshot } from "@/src/studio/regenerate-demo";
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
  const rewrite = await demoRewriteSnapshot(sql);
  const pause = await readGeminiPause(sql);
  const geminiPause = pause?.perDay ? pause.message : null;

  return (
    <PengaturanForm
      settings={settings}
      llmBanner={studioModelLine(llmBanner().text, geminiPause)}
      geminiPause={geminiPause}
      demoReviewCount={rewrite.demoScores}
      regenerateProgress={{ done: rewrite.done, total: rewrite.total }}
    />
  );
}
