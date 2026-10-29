import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";
import { bytesFromDb } from "@/src/rss/image-cache";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sql = await getAppSql();
  const user = await userForToken(sql, token);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = await sql.rows<{ logo: unknown; logo_type: string | null }>(
    "select logo, logo_type from brand where id = 1",
  );
  const bytes = bytesFromDb(rows[0]?.logo);
  const type = rows[0]?.logo_type ?? "";
  if (!bytes || !["image/png", "image/jpeg", "image/webp"].includes(type)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": type,
      "cache-control": "private, no-store",
    },
  });
}
