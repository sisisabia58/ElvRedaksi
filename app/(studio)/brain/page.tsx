import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { can } from "@/src/auth/rbac";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { relativeId } from "@/src/domain/metrics";
import { listBrain } from "@/src/studio/brain";
import { BrainVault } from "./brain-vault";

export default async function BrainPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const params = await searchParams;
  const sql = await getAppSql();
  const docs = await listBrain(sql);
  const now = new Date();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const user = token ? await userForToken(sql, token) : null;
  const canWrite = user ? can(user.role, "brain.write") : false;

  const docViews = docs.map((doc) => ({
    slug: doc.slug,
    title: doc.title,
    body: doc.body,
    locked: doc.locked,
    relative: relativeId(doc.updatedAt, now),
  }));

  const selectedSlug = params.slug ?? docs[0]?.slug;

  return <BrainVault docs={docViews} selectedSlug={selectedSlug} canWrite={canWrite} />;
}
