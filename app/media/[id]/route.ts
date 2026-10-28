import { NextResponse } from "next/server";
import { getAppSql } from "@/src/auth/app-sql";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const sql = await getAppSql();
  const rows = await sql.rows<{ bytes: Buffer }>(
    `select a.bytes
     from assets a
     join drafts d on d.id = a.draft_id
     where a.id = $1 and d.status in ('posting', 'posted')`,
    [id],
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = rows[0].bytes;
  return new NextResponse(body, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}
