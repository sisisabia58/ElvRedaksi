import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppSql } from "@/src/auth/app-sql";
import { SESSION_COOKIE, userForToken } from "@/src/auth/session";

type RouteParams = { params: Promise<{ id: string; index: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id, index: indexRaw } = await params;
  const slideIndex = Number.parseInt(indexRaw, 10);
  if (!Number.isFinite(slideIndex) || slideIndex < 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sql = await getAppSql();
  const user = await userForToken(sql, token);
  if (!user) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await sql.rows<{ bytes: Buffer }>(
    `select a.bytes
     from assets a
     where a.draft_id = $1 and a.slide_index = $2`,
    [id, slideIndex],
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(rows[0].bytes), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
    },
  });
}
